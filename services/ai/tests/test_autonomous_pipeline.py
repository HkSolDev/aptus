"""Unit tests for the autonomous end-to-end pipeline, 7-rule acceptance, Vision recovery, targeted enrichment, retry backoff, and audit lineage."""

import copy
import json
import tempfile
import unittest
from datetime import datetime, timedelta, timezone
from pathlib import Path

from autonomous_pipeline import (
    _sync_missing_fields,
    evaluate_automated_acceptance,
    run_autonomous_notice,
)
from build_extraction_input import CandidatePost


def _make_base_prepared(
    *,
    bundle_id: str = 'upessc-hm-2026',
    authority: str = 'official_host_candidate',
    pdf_text: str = (
        'Uttar Pradesh Education Service Selection Commission (UPESSC) Advt No. 01/2026. '
        'Post: Headmaster. Minimum qualification: Postgraduate with B.Ed. '
        'Age limit: 21 to 40 years. Total vacancies: 120. Application last date: 2026-12-15. '
        'Job Location: Prayagraj, UP.'
    ),
) -> dict:
    return {
        'bundle_id': bundle_id,
        'llm_input': {
            'input': {
                'bundle_id': bundle_id,
                'identity': {
                    'issuer': 'Uttar Pradesh Education Service Selection Commission',
                    'advertisement_number': '01/2026',
                    'year': '2026',
                    'authority': authority,
                },
                'coverage': {'review_reasons': []},
                'documents': [
                    {
                        'document_id': 'doc-official-pdf',
                        'format': 'pdf',
                        'role': 'primary',
                        'authority': authority,
                        'source_url': 'https://upessc.up.gov.in/notices/advt-01-2026.pdf',
                        'title': 'UPESSC Advt 01/2026 Official Notification',
                        'sections': [
                            {
                                'evidence_id': 'doc-official-pdf:s1',
                                'title': 'Main Section',
                                'text': pdf_text,
                                'locations': [{'kind': 'pdf_page', 'page': 6, 'locator': 'page:6'}],
                            }
                        ],
                    }
                ],
            }
        },
    }


def _make_vision_bundle(native_status: str = 'suspicious_or_unusable') -> dict:
    return {
        'bundle_id': 'upessc-unreadable-p6',
        'identity': {
            'issuer': 'Uttar Pradesh Education Service Selection Commission',
            'advertisement_number': '01/2026',
        },
        'review_reasons': [],
        'documents': [
            {
                'document_id': 'doc-official-pdf',
                'format': 'pdf',
                'role': 'main_notice',
                'source_url': 'https://upessc.up.gov.in/notices/advt-01-2026.pdf',
                'identity': {
                    'issuer': 'Uttar Pradesh Education Service Selection Commission',
                    'advertisement_number': '01/2026',
                },
                'review_reasons': [],
                'content': {
                    'pages': [{'number': 6, 'native_status': native_status}],
                    'blocks': [
                        {
                            'page': 6,
                            'alternatives': [{'method': 'native_text', 'text': 'mojibake-native-text'}],
                        }
                    ],
                    'sections': [],
                    'coverage': {'unreadable_pages': [6] if native_status != 'usable_candidate' else []},
                },
            }
        ],
    }


def _make_extracted(
    *,
    bundle_id: str = 'upessc-hm-2026',
    application_last_date: str | None = '2026-12-15',
    vacancies: int | None = 120,
    include_age: bool = True,
    include_education: bool = True,
    location: str | None = None,
) -> dict:
    post = {name: None for name in CandidatePost.model_fields}
    for name in (
        'exam_dates',
        'locations',
        'vacancy_breakdown',
        'experience_rules',
        'fee_rules',
        'selection_process',
        'application_steps',
        'documents_required',
        'language_requirements',
        'other_requirements',
    ):
        post[name] = []
    post['eligibility_rules'] = {
        'gender_requirement': None,
        'category_requirement': [],
        'education_options': [],
        'age_rules': [],
        'relaxation_combination_rule': None,
    }
    post['post_name'] = 'Headmaster'
    post['recruiting_body'] = 'Uttar Pradesh Education Service Selection Commission (UPESSC)'
    post['advertisement_number'] = '01/2026'
    post['application_last_date'] = application_last_date
    post['vacancies'] = vacancies

    evidence = [
        {
            'field_path': 'posts.0.post_name',
            'evidence_id': 'doc-official-pdf:s1',
            'quote': 'Post: Headmaster.',
        },
        {
            'field_path': 'posts.0.recruiting_body',
            'evidence_id': 'doc-official-pdf:s1',
            'quote': 'Uttar Pradesh Education Service Selection Commission (UPESSC)',
        },
        {
            'field_path': 'posts.0.advertisement_number',
            'evidence_id': 'doc-official-pdf:s1',
            'quote': 'Advt No. 01/2026.',
        },
    ]
    if application_last_date is not None:
        evidence.append({
            'field_path': 'posts.0.application_last_date',
            'evidence_id': 'doc-official-pdf:s1',
            'quote': f'Application last date: {application_last_date}.',
        })
    if vacancies is not None:
        evidence.append({
            'field_path': 'posts.0.vacancies',
            'evidence_id': 'doc-official-pdf:s1',
            'quote': f'Total vacancies: {vacancies}.',
        })
    if location is not None:
        post['locations'] = [location]
        evidence.append({
            'field_path': 'posts.0.locations.0',
            'evidence_id': 'doc-official-pdf:s1',
            'quote': f'Job Location: {location}.',
        })
    if include_age:
        post['min_age'] = 21
        post['max_age'] = 40
        evidence.extend([
            {
                'field_path': 'posts.0.min_age',
                'evidence_id': 'doc-official-pdf:s1',
                'quote': 'Age limit: 21 to 40 years.',
            },
            {
                'field_path': 'posts.0.max_age',
                'evidence_id': 'doc-official-pdf:s1',
                'quote': 'Age limit: 21 to 40 years.',
            },
        ])
    if include_education:
        post['education_required'] = 'Postgraduate with B.Ed.'
        evidence.append({
            'field_path': 'posts.0.education_required',
            'evidence_id': 'doc-official-pdf:s1',
            'quote': 'Minimum qualification: Postgraduate with B.Ed.',
        })

    facts = {
        'purpose': 'recruitment',
        'purpose_evidence': [
            {
                'evidence_id': 'doc-official-pdf:s1',
                'quote': 'Post: Headmaster.',
            }
        ],
        'document_purposes': [
            {
                'document_id': 'doc-official-pdf',
                'purpose': 'recruitment',
                'evidence': [
                    {
                        'evidence_id': 'doc-official-pdf:s1',
                        'quote': 'Post: Headmaster.',
                    }
                ],
            }
        ],
        'amendment': None,
        'posts': [post],
        'evidence': evidence,
        'missing_fields': [],
    }
    _sync_missing_fields(facts)

    return {
        'bundle_id': bundle_id,
        'provider': 'gemini',
        'model': 'gemini-2.5-flash',
        'usage': {'total_tokens': 120},
        'review_reasons': [],
        'inline_check': {'errors': [], 'fields': []},
        'facts': facts,
    }


class FakeVisionProvider:
    def __init__(self, response_data=None):
        self.calls = 0
        self.response_data = response_data

    def recover_pdf_page(self, **kwargs):
        self.calls += 1
        return {
            'status': 'ok',
            'data': self.response_data,
            'raw_text': json.dumps(self.response_data, ensure_ascii=False),
        }


class FakeSearchClient:
    def __init__(self):
        self.calls = 0

    def discover_for_request(self, req):
        self.calls += 1
        if req['target_type'] == 'missing_or_weak_field' and req['field_path'] == 'application_last_date':
            return {
                'status': 'ok',
                'candidates': [
                    {
                        'source_url': 'https://upessc.up.gov.in/notices/corrigendum-01-2026.pdf',
                        'value': '2026-12-20',
                        'exact_quote': 'Headmaster Advt 01/2026 extended application last date is 2026-12-20.',
                        'post_binding_quote': 'Headmaster Advt 01/2026 extended application last date is 2026-12-20.',
                    }
                ],
            }
        if req['target_type'] == 'official_syllabus':
            return {
                'status': 'ok',
                'candidates': [
                    {
                        'source_url': 'https://upessc.up.gov.in/notices/syllabus-01-2026.pdf',
                        'exam_name': 'UPESSC Headmaster Written Exam',
                        'exam_pattern': '150 Objective MCQs',
                        'subjects': ['General Studies', 'Educational Administration'],
                        'topics': ['School Management'],
                        'exact_quote': 'Headmaster Advt 01/2026 UPESSC Headmaster Written Exam: 150 Objective MCQs covering General Studies and Educational Administration.',
                        'post_binding_quote': 'Headmaster Advt 01/2026 UPESSC Headmaster Written Exam: 150 Objective MCQs covering General Studies and Educational Administration.',
                    }
                ],
            }
        return {
            'status': 'ok',
            'candidates': [
                {
                    'source_url': 'https://upessc.up.gov.in/notices/cutoff-2022.pdf',
                    'recruitment_year': 2022,
                    'stage': 'Written',
                    'category': 'OBC',
                    'score_type': 'marks',
                    'score': 312.5,
                    'maximum_score': 500.0,
                    'exact_quote': 'Uttar Pradesh Education Service Selection Commission Headmaster Cutoff 2022 (Written): OBC 312.5 / 500 marks.',
                    'post_binding_quote': 'Uttar Pradesh Education Service Selection Commission Headmaster Cutoff 2022 (Written): OBC 312.5 / 500 marks.',
                }
            ],
        }


class FakeCaptureClient:
    def capture_source(self, url: str):
        return {
            'status': 'captured',
            'source_url': url,
            'document_id': 'captured-official-doc',
            'sha256': 'c' * 64,
            'captured_at': '2026-11-03T10:05:00Z',
            'text_units': [
                {
                    'page': 1,
                    'locator': 'page:1:sec:1',
                    'text': (
                        'Uttar Pradesh Education Service Selection Commission (UPESSC) Advt 01/2026. '
                        'Headmaster Advt 01/2026 extended application last date is 2026-12-20. '
                        'Headmaster Advt 01/2026 UPESSC Headmaster Written Exam: 150 Objective MCQs covering General Studies and Educational Administration. '
                        'Uttar Pradesh Education Service Selection Commission Headmaster Cutoff 2022 (Written): OBC 312.5 / 500 marks.'
                    ),
                }
            ],
        }


class AutonomousPipelineTests(unittest.TestCase):
    def test_complete_valid_fixture_passes_automated_acceptance_and_publishes(self):
        with tempfile.TemporaryDirectory() as tmp:
            prepared = _make_base_prepared()
            extracted = _make_extracted()
            persisted = []

            result = run_autonomous_notice(
                tmp,
                prepared,
                source_name='UPESSC Official',
                extract_fn=lambda _: extracted,
                persist_fn=lambda payload: persisted.append(payload) or {'status': 'published'},
            )

            self.assertEqual(result['decision'], 'accepted')
            self.assertEqual(result['publication_status'], 'published')
            self.assertEqual(result['reason_codes'], [])
            self.assertIsNotNone(result['draft_envelope'])
            self.assertIsNotNone(result['ingest_payload']['draftEnvelope'])
            self.assertEqual(
                result['draft_envelope']['review']['automated_decision']['decision'],
                'accepted',
            )
            self.assertIn(
                'extraction_version',
                result['draft_envelope']['review']['automated_decision'],
            )
            self.assertEqual(len(persisted), 1)
            self.assertEqual(len(result['ingest_payload']['posts']), 1)
            self.assertEqual(result['ingest_payload']['posts'][0]['title'], 'Headmaster')
            self.assertEqual(result['ingest_payload']['posts'][0]['totalVacancies'], 120)

    def test_storage_contract_failure_downgrades_accepted_to_blocked(self):
        from unittest.mock import patch

        with tempfile.TemporaryDirectory() as tmp:
            persisted = []
            with patch('autonomous_pipeline.prepare_storage', side_effect=ValueError('schema mismatch')):
                result = run_autonomous_notice(
                    tmp,
                    _make_base_prepared(bundle_id='upessc-contract-fail'),
                    source_name='UPESSC Official',
                    extract_fn=lambda _: _make_extracted(bundle_id='upessc-contract-fail'),
                    persist_fn=lambda payload: persisted.append(payload),
                )
            self.assertEqual(result['decision'], 'blocked')
            self.assertEqual(result['publication_status'], 'blocked')
            self.assertFalse(result['persistence_allowed'])
            self.assertIsNone(result['draft_envelope'])
            self.assertIsNone(result['ingest_payload']['draftEnvelope'])
            self.assertEqual(result['ingest_payload']['posts'], [])
            self.assertIn('candidate_storage_contract_failed:ValueError', result['reason_codes'])
            self.assertEqual(len(persisted), 1)
            self.assertEqual(persisted[0]['decision'], 'blocked')
            self.assertFalse(persisted[0]['persistenceAllowed'])
            self.assertEqual(persisted[0]['posts'], [])

    def test_vision_candidate_facts_merge_qualification_and_date_and_reject_conflicts_or_unsupported_fields(self):
        with tempfile.TemporaryDirectory() as tmp:
            # 1. Qualification + application_last_date recovered via Vision candidate_facts
            vision_payload = {
                'physical_pdf_page': 6,
                'visible_issuer': 'Uttar Pradesh Education Service Selection Commission',
                'visible_advertisement_number': '01/2026',
                'page_text_quote': (
                    'Post: Headmaster. Minimum qualification: Postgraduate with B.Ed. '
                    'Application last date: 2026-12-15.'
                ),
                'posts': [
                    {
                        'post_name': 'Headmaster',
                        'post_binding_quote': 'Post: Headmaster.',
                        'candidate_facts': [
                            {
                                'field_path': 'education_required',
                                'value': 'Postgraduate with B.Ed.',
                                'exact_quote': 'Minimum qualification: Postgraduate with B.Ed.',
                                'physical_pdf_page': 6,
                                'section_locator': 'page:6:edu',
                                'conditions': None,
                            },
                            {
                                'field_path': 'application_last_date',
                                'value': '2026-12-15',
                                'exact_quote': 'Application last date: 2026-12-15.',
                                'physical_pdf_page': 6,
                                'section_locator': 'page:6:dates',
                                'conditions': None,
                            },
                        ],
                        'experience_alternatives': [],
                    }
                ],
            }
            v_provider = FakeVisionProvider(vision_payload)
            v_bundle = _make_vision_bundle('suspicious_or_unusable')
            res_ok = run_autonomous_notice(
                Path(tmp) / 'vision_facts_ok',
                _make_base_prepared(bundle_id='upessc-vision-facts-ok'),
                source_name='UPESSC Official',
                extract_fn=lambda _: _make_extracted(
                    bundle_id='upessc-vision-facts-ok',
                    include_education=False,
                    application_last_date=None,
                ),
                vision_bundle=v_bundle,
                vision_provider=v_provider,
                pdf_bytes_by_doc={'doc-official-pdf': b'%PDF-1.4'},
                page_images_by_doc={'doc-official-pdf': {6: b'\x89PNG'}},
            )
            self.assertEqual(res_ok['decision'], 'accepted')
            self.assertIsNotNone(res_ok['draft_envelope'])
            post_out = res_ok['ingest_payload']['posts'][0]
            self.assertEqual(post_out['minEducation'], 'Postgraduate with B.Ed.')
            self.assertEqual(
                res_ok['extracted']['facts']['posts'][0]['education_required'],
                'Postgraduate with B.Ed.',
            )
            self.assertEqual(post_out['applicationLastDate'], '2026-12-15')
            vision_ev = [
                ev
                for ev in res_ok['draft_envelope']['evidence_units']
                if ':fact:' in ev.get('evidence_id', '')
            ]
            self.assertEqual(len(vision_ev), 2)
            self.assertTrue(all(ev.get('document_id') == 'doc-official-pdf' for ev in vision_ev))
            self.assertTrue(
                all(ev.get('locations', [{}])[0].get('page') == 6 for ev in vision_ev)
            )
            self.assertEqual(
                {ev.get('locations', [{}])[0].get('locator') for ev in vision_ev},
                {'page:6:edu', 'page:6:dates'},
            )

            # 2. Conflicting Vision candidate_fact must NOT overwrite extracted value and blocks acceptance
            conflict_payload = copy.deepcopy(vision_payload)
            conflict_payload['page_text_quote'] = (
                'Post: Headmaster. Application last date: 2026-12-25.'
            )
            conflict_payload['posts'][0]['candidate_facts'] = [
                {
                    'field_path': 'application_last_date',
                    'value': '2026-12-25',
                    'exact_quote': 'Application last date: 2026-12-25.',
                    'physical_pdf_page': 6,
                    'section_locator': 'page:6:dates',
                    'conditions': None,
                }
            ]
            res_conflict = run_autonomous_notice(
                Path(tmp) / 'vision_conflict',
                _make_base_prepared(bundle_id='upessc-vision-conflict'),
                source_name='UPESSC Official',
                extract_fn=lambda _: _make_extracted(
                    bundle_id='upessc-vision-conflict',
                    application_last_date='2026-12-15',
                ),
                vision_bundle=_make_vision_bundle('suspicious_or_unusable'),
                vision_provider=FakeVisionProvider(conflict_payload),
                pdf_bytes_by_doc={'doc-official-pdf': b'%PDF-1.4'},
                page_images_by_doc={'doc-official-pdf': {6: b'\x89PNG'}},
            )
            self.assertEqual(res_conflict['decision'], 'blocked')
            self.assertIn(
                'vision_extracted_fact_conflict:Headmaster:application_last_date',
                res_conflict['reason_codes'],
            )
            # Extracted value was never overwritten
            self.assertEqual(
                res_conflict['extracted']['facts']['posts'][0]['application_last_date'],
                '2026-12-15',
            )
            self.assertEqual(res_conflict['ingest_payload']['posts'], [])

            # 3. Unsupported Vision candidate_fact field remains unresolved and blocks acceptance
            unsupported_payload = copy.deepcopy(vision_payload)
            unsupported_payload['posts'][0]['candidate_facts'] = [
                {
                    'field_path': 'selection_bonus',
                    'value': '5 marks',
                    'exact_quote': 'Minimum qualification: Postgraduate with B.Ed.',
                    'physical_pdf_page': 6,
                    'section_locator': 'page:6:bonus',
                    'conditions': None,
                }
            ]
            res_unsupported = run_autonomous_notice(
                Path(tmp) / 'vision_unsupported',
                _make_base_prepared(bundle_id='upessc-vision-unsupported'),
                source_name='UPESSC Official',
                extract_fn=lambda _: _make_extracted(bundle_id='upessc-vision-unsupported'),
                vision_bundle=_make_vision_bundle('suspicious_or_unusable'),
                vision_provider=FakeVisionProvider(unsupported_payload),
                pdf_bytes_by_doc={'doc-official-pdf': b'%PDF-1.4'},
                page_images_by_doc={'doc-official-pdf': {6: b'\x89PNG'}},
            )
            self.assertEqual(res_unsupported['decision'], 'blocked')
            self.assertTrue(
                any('vision_unsupported_field' in r for r in res_unsupported['reason_codes'])
            )

    def test_incomplete_third_party_unquoted_or_mismatched_fixtures_are_blocked_or_retryable(self):
        with tempfile.TemporaryDirectory() as tmp:
            # 1. Third-party authority -> blocked
            third_party = _make_base_prepared(authority='third_party')
            res_tp = run_autonomous_notice(
                tmp,
                third_party,
                source_name='Third Party Blog',
                extract_fn=lambda _: _make_extracted(),
            )
            self.assertEqual(res_tp['decision'], 'blocked')
            self.assertEqual(res_tp['ingest_payload']['posts'], [])
            self.assertTrue(any('authority' in r or 'official' in r for r in res_tp['reason_codes']))

            # 2. Unquoted / fabricated quote -> blocked
            bad_quote_extracted = _make_extracted()
            bad_quote_extracted['facts']['evidence'][0]['quote'] = 'Text not in PDF anywhere'
            res_bq = evaluate_automated_acceptance(
                bad_quote_extracted,
                _make_base_prepared()['llm_input']['input'],
            )
            self.assertEqual(res_bq['decision'], 'blocked')

            # 3. Missing core field (application_last_date) without research recovery -> retryable
            res_inc = run_autonomous_notice(
                Path(tmp) / 'retryable_case',
                _make_base_prepared(bundle_id='upessc-missing-date'),
                source_name='UPESSC Official',
                extract_fn=lambda _: _make_extracted(bundle_id='upessc-missing-date', application_last_date=None),
            )
            self.assertEqual(res_inc['decision'], 'retryable')
            self.assertEqual(res_inc['publication_status'], 'retryable')
            self.assertEqual(res_inc['ingest_payload']['posts'], [])
            self.assertIn('missing_core_field:Headmaster:application_last_date', res_inc['reason_codes'])
            self.assertGreater(res_inc['state']['backoff_seconds'], 0)

    def test_unreadable_verified_pdf_page_calls_vision_while_readable_page_does_not(self):
        with tempfile.TemporaryDirectory() as tmp:
            # Readable page -> zero Vision calls
            readable_vision = FakeVisionProvider()
            run_autonomous_notice(
                Path(tmp) / 'readable',
                _make_base_prepared(),
                source_name='UPESSC Official',
                extract_fn=lambda _: _make_extracted(),
                vision_bundle=_make_vision_bundle('usable_candidate'),
                vision_provider=readable_vision,
                pdf_bytes_by_doc={'doc-official-pdf': b'%PDF-1.4'},
                page_images_by_doc={'doc-official-pdf': {6: b'\x89PNG'}},
            )
            self.assertEqual(readable_vision.calls, 0)

            # Unreadable page -> invokes Vision, preserves native_text, recovers experience rule
            vision_payload = {
                'physical_pdf_page': 6,
                'visible_issuer': 'Uttar Pradesh Education Service Selection Commission',
                'visible_advertisement_number': '01/2026',
                'page_text_quote': 'Post: Headmaster. प्रधानाध्यापक को जूनियर हाई स्कूल (Class 6 to 8) में 4 वर्ष का अनुभव। Countersigned by BSA.',
                'posts': [
                    {
                        'post_name': 'Headmaster',
                        'post_binding_quote': 'Post: Headmaster.',
                        'candidate_facts': [],
                        'experience_alternatives': [
                            {
                                'minimum_years': 4,
                                'role_titles': ['प्रधानाध्यापक'],
                                'institution_or_scope': 'जूनियर हाई स्कूल',
                                'class_scope': 'Class 6 to 8',
                                'certificate_requirement': 'Countersigned by BSA',
                                'supporting_quote': 'प्रधानाध्यापक को जूनियर हाई स्कूल (Class 6 to 8) में 4 वर्ष का अनुभव। Countersigned by BSA.',
                                'physical_pdf_page': 6,
                                'source_locator': 'page:6:col:3',
                            }
                        ],
                    }
                ],
            }
            unreadable_vision = FakeVisionProvider(vision_payload)
            v_bundle = _make_vision_bundle('suspicious_or_unusable')
            res_vision = run_autonomous_notice(
                Path(tmp) / 'unreadable',
                _make_base_prepared(bundle_id='upessc-unreadable-p6'),
                source_name='UPESSC Official',
                extract_fn=lambda _: _make_extracted(
                    bundle_id='upessc-unreadable-p6',
                    vacancies=None,
                    include_age=False,
                ),
                vision_bundle=v_bundle,
                vision_provider=unreadable_vision,
                pdf_bytes_by_doc={'doc-official-pdf': b'%PDF-1.4'},
                page_images_by_doc={'doc-official-pdf': {6: b'\x89PNG'}},
            )
            self.assertEqual(unreadable_vision.calls, 1)
            self.assertTrue(res_vision['vision_called'])
            self.assertEqual(res_vision['decision'], 'accepted')
            self.assertEqual(res_vision['ingest_payload']['posts'][0]['experienceYears'], 4)
            # Verify native_text was never overwritten
            self.assertEqual(
                v_bundle['documents'][0]['content']['blocks'][0]['alternatives'][0]['text'],
                'mojibake-native-text',
            )

    def test_missing_field_triggers_research_and_retains_syllabus_and_cutoffs_without_affecting_eligibility(self):
        with tempfile.TemporaryDirectory() as tmp:
            prepared = _make_base_prepared(bundle_id='upessc-enrich-2026')
            extracted = _make_extracted(bundle_id='upessc-enrich-2026', application_last_date=None)
            search_client = FakeSearchClient()
            capture_client = FakeCaptureClient()

            result = run_autonomous_notice(
                tmp,
                prepared,
                source_name='UPESSC Official',
                extract_fn=lambda _: copy.deepcopy(extracted),
                search_client=search_client,
                capture_client=capture_client,
                issuer_hosts={
                    'Uttar Pradesh Education Service Selection Commission': ['upessc.up.gov.in'],
                },
                include_syllabus=True,
                include_historical_cutoffs=True,
            )

            self.assertEqual(search_client.calls, 3)
            self.assertEqual(result['decision'], 'accepted')
            post_out = result['ingest_payload']['posts'][0]
            self.assertEqual(post_out['applicationLastDate'], '2026-12-20')
            # Historical cutoffs and syllabus must never alter minMarksPercent or eligibility fields
            self.assertIsNone(post_out['minMarksPercent'])
            self.assertEqual(len(result['ingest_payload']['officialSyllabus']), 1)
            self.assertEqual(
                result['ingest_payload']['officialSyllabus'][0]['exam_name'],
                'UPESSC Headmaster Written Exam',
            )
            self.assertEqual(len(result['ingest_payload']['historicalCutoffs']), 1)
            self.assertTrue(result['ingest_payload']['historicalCutoffs'][0]['reference_only'])

    def test_idempotent_repeat_backoff_and_stronger_evidence_audit_lineage(self):
        with tempfile.TemporaryDirectory() as tmp:
            now_dt = datetime(2026, 11, 3, 10, 0, 0, tzinfo=timezone.utc)
            current_time = [now_dt]
            extract_calls = [0]

            def count_extract(_):
                extract_calls[0] += 1
                return _make_extracted()

            # 1. First accepted run
            first = run_autonomous_notice(
                tmp,
                _make_base_prepared(),
                source_name='UPESSC Official',
                extract_fn=count_extract,
                clock=lambda: current_time[0],
            )
            self.assertEqual(first['decision'], 'accepted')
            self.assertFalse(first['reused_accepted'])
            self.assertEqual(extract_calls[0], 1)

            # 2. Second identical run is idempotent and skips extraction/provider calls
            second = run_autonomous_notice(
                tmp,
                _make_base_prepared(),
                source_name='UPESSC Official',
                extract_fn=count_extract,
                clock=lambda: current_time[0],
            )
            self.assertEqual(second['decision'], 'accepted')
            self.assertTrue(second['reused_accepted'])
            self.assertEqual(extract_calls[0], 1)

            # 3. Stronger later official evidence updates supported field (locations) and records audit_lineage
            stronger_text = (
                'Uttar Pradesh Education Service Selection Commission (UPESSC) Advt No. 01/2026. '
                'Post: Headmaster. Minimum qualification: Postgraduate with B.Ed. '
                'Age limit: 21 to 40 years. Total vacancies: 120. Application last date: 2026-12-15. '
                'Job Location: Prayagraj, UP. Additional details.'
            )
            stronger_prepared = _make_base_prepared(pdf_text=stronger_text)
            third = run_autonomous_notice(
                tmp,
                stronger_prepared,
                source_name='UPESSC Official',
                extract_fn=lambda _: _make_extracted(location='Prayagraj, UP'),
                clock=lambda: current_time[0] + timedelta(minutes=10),
            )
            self.assertEqual(third['decision'], 'accepted')
            self.assertEqual(third['ingest_payload']['posts'][0]['location'], 'Prayagraj, UP')
            self.assertEqual(len(third['ingest_payload']['auditLineage']), 1)
            lineage_entry = third['ingest_payload']['auditLineage'][0]
            self.assertEqual(lineage_entry['post_name'], 'Headmaster')
            self.assertEqual(lineage_entry['field_path'], 'locations')
            self.assertEqual(lineage_entry['previous_value'], [])
            self.assertEqual(lineage_entry['new_value'], ['Prayagraj, UP'])

            # 4. Backoff prevents repeated paid calls on retryable notice before next_retry_at
            retry_calls = [0]

            def retry_extract(_):
                retry_calls[0] += 1
                return _make_extracted(bundle_id='retry-bundle', application_last_date=None)

            r1 = run_autonomous_notice(
                tmp,
                _make_base_prepared(bundle_id='retry-bundle'),
                source_name='UPESSC Official',
                extract_fn=retry_extract,
                clock=lambda: current_time[0],
            )
            self.assertEqual(r1['decision'], 'retryable')
            self.assertFalse(r1['backoff_skipped'])
            self.assertEqual(retry_calls[0], 1)

            # Re-run 60s later (within 300s backoff window) -> skipped without calling extract_fn
            r2 = run_autonomous_notice(
                tmp,
                _make_base_prepared(bundle_id='retry-bundle'),
                source_name='UPESSC Official',
                extract_fn=retry_extract,
                clock=lambda: current_time[0] + timedelta(seconds=60),
            )
            self.assertEqual(r2['decision'], 'retryable')
            self.assertTrue(r2['backoff_skipped'])
            self.assertEqual(retry_calls[0], 1)


if __name__ == '__main__':
    unittest.main()
