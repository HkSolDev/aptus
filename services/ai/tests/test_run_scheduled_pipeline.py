import hashlib
import json
import tempfile
import unittest
from pathlib import Path

from capture_store import atomic_write, read_state
from run_scheduled_pipeline import run_pipeline
from schema import Post
from sources.sarkariresult import Page


def post():
    return Post.model_validate({
        'post_name': 'Illustrative Clerk', 'recruiting_body': 'Example Recruitment Board', 'vacancies': 3,
        'application_last_date': '2026-11-30', 'age_as_on_date': None,
        'min_age': 18, 'max_age': 27, 'education_required': 'Bachelor degree',
        'post_group': None, 'pay_level': None, 'min_education_level': 'BACHELORS',
        'min_marks_percent': None, 'category_relaxation_applies': None,
        'category_relaxation_rules': None,
        'eligibility_rules': {'gender_requirement': None, 'category_requirement': [],
            'education_options': [{'minimum_level': 'BACHELORS',
                'minimum_marks_percent': None, 'qualification': 'Bachelor degree',
                'subject_requirement': None, 'conditions': None}],
            'age_rules': [{'category': None, 'gender': None, 'min_age': 18,
                'max_age': 27, 'relaxation_years': None, 'conditions': None}],
            'relaxation_combination_rule': None},
    })


class ScheduledPipelineTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        self.root = Path(self.directory.name)
        self.url = 'https://www.sarkariresult.com/2026/illustrative-form/'
        source = self.root / 'sarkariresult'
        atomic_write(source / 'discovered.json', json.dumps([{
            'url': self.url, 'title': 'Illustrative Online Form',
            'source': 'sarkariresult',
        }]).encode())
        body = b'<html><body>Illustrative Clerk Age 18 to 27 Bachelor degree</body></html>'
        body_path = source / 'body.html'
        atomic_write(body_path, body)
        state_path, _ = read_state(source / 'documents', self.url)
        atomic_write(state_path, json.dumps({'snapshot': {
            'sha256': hashlib.sha256(body).hexdigest(), 'body_path': str(body_path),
            'document_kind': 'html',
        }}).encode())
        self.collection = {'status': 'completed', 'sources': {
            'sarkariresult': {'status': 'completed', 'discovered': 1,
                              'captured': 1, 'failed': 0}}}

    def page(self, _html):
        return Page('Illustrative Clerk Age 18 to 27 Bachelor degree', {}, {'age_limit': '18 to 27'})

    def test_publishes_once_then_skips_unchanged_snapshot(self):
        pushed = []
        options = dict(collect_documents=lambda _root: self.collection,
                       parse_document=self.page, extract_document=lambda *_args, **_kwargs: [post()],
                       push=lambda payload: pushed.append(payload) or {'created': 1})
        first = run_pipeline(self.root, **options)
        second = run_pipeline(self.root, **options)
        self.assertEqual(first['sources']['sarkariresult']['published'], 1)
        self.assertEqual(second['sources']['sarkariresult']['unchanged'], 1)
        self.assertEqual(len(pushed), 1)
        self.assertEqual(pushed[0]['posts'][0]['recruiting_body'], 'Example Recruitment Board')
        self.assertEqual(pushed[0]['source_name'], 'sarkariresult: Illustrative Online Form')

    def test_ingest_failure_saves_payload_and_retries_without_another_llm_call(self):
        extracts = []
        calls = []
        def push(payload):
            calls.append(payload)
            if len(calls) == 1:
                raise RuntimeError('temporary_ingest_failure')
            return {'created': 1}
        options = dict(collect_documents=lambda _root: self.collection,
                       parse_document=self.page,
                       extract_document=lambda *_args, **_kwargs: extracts.append(True) or [post()],
                       push=push)
        first = run_pipeline(self.root, **options)
        second = run_pipeline(self.root, **options)
        self.assertEqual(first['sources']['sarkariresult']['pending'], 1)
        self.assertEqual(second['sources']['sarkariresult']['published'], 1)
        self.assertEqual(len(extracts), 1)


if __name__ == '__main__':
    unittest.main()
