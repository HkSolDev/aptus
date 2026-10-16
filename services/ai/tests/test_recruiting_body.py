"""Fictional provider responses: contract/grounding checks, not model accuracy."""
import unittest
from unittest.mock import Mock, patch
from types import SimpleNamespace

import pipeline

from pydantic import ValidationError
from extract import extract_posts, SYSTEM_PROMPT
from schema import Post, PostBatch
from services.ai.tests import test_validate_candidate


class RecruitingBodyTests(unittest.TestCase):
    def post(self, **overrides):
        post = {name: None for name in Post.model_fields}
        post.update(post_name='Assistant', eligibility_rules={
            'gender_requirement': None, 'category_requirement': [],
            'education_options': [], 'age_rules': [], 'relaxation_combination_rule': None})
        post.update(overrides)
        return post

    def extract(self, name, text):
        provider = Mock()
        provider.extract_posts.return_value = PostBatch(posts=[self.post(recruiting_body=name)])
        with patch('extract.get_llm_provider', return_value=provider):
            return extract_posts(text)[0].model_dump(mode='json')

    def test_named_recruiter_survives_extraction_and_json(self):
        self.assertEqual(self.extract('Example Research Council',
            'Example Research Council invites applications for Assistant.')['recruiting_body'],
            'Example Research Council')
        self.assertIn('source website', SYSTEM_PROMPT)

    def test_missing_unclear_or_unlocated_name_stays_null(self):
        for value in (None, 'Invented Recruiter'):
            self.assertIsNone(self.extract(value,
                'Published by Example Jobs Portal. Assistant vacancy; recruiter unclear.')['recruiting_body'])

    def test_pipeline_handoff_keeps_recruiter_separate_from_source_name(self):
        post = Post(**self.post(recruiting_body='Example Research Council'))
        page = SimpleNamespace(text='Example Research Council recruits Assistant.', sections={}, links={})
        with patch.multiple(pipeline, load_cache=Mock(return_value={}),
                list_jobs=Mock(return_value=[('Assistant listing', 'https://example.org/notice')]),
                fetch=Mock(return_value=page), extract_posts=Mock(return_value=[post]),
                save_cache=Mock(), push_to_ts=Mock(return_value={})):
            pipeline.run_pipeline()
            payload = pipeline.push_to_ts.call_args.args[0]
        self.assertEqual(payload['posts'][0]['recruiting_body'], 'Example Research Council')
        self.assertEqual(payload['source_name'], 'SarkariResult: Assistant listing')

    def test_bounded_nullable_contract(self):
        self.assertIsNone(Post(**self.post(recruiting_body='   ')).recruiting_body)
        for value in (True, 12, 'x' * 201):
            with self.assertRaises(ValidationError):
                Post(**self.post(recruiting_body=value))

    def test_candidate_requires_recruiter_in_located_citation(self):
        helper = test_validate_candidate.CandidateValidationTests()
        result, source = helper.candidate()
        path = 'posts.0.recruiting_body'
        result['facts']['posts'][0]['recruiting_body'] = 'Example Research Council'
        result['facts']['missing_fields'] = [entry for entry in result['facts']['missing_fields']
                                            if entry['field_path'] != path]
        result['facts']['evidence'].append({'field_path': path,
            'evidence_id': 'main:unit-0', 'quote': 'Engineer'})
        from validate_candidate import validate_candidate
        self.assertEqual(validate_candidate(result, source)['status'], 'blocked')
        quote = 'Example Research Council invites applications for Engineer.'
        source['documents'][0]['sections'][0]['text'] += '\n' + quote
        result['facts']['evidence'][-1]['quote'] = quote
        report = validate_candidate(result, source)
        self.assertEqual(report['errors'], [])
        self.assertEqual(report['validated_facts']['posts'][0]['recruiting_body'],
                         'Example Research Council')


if __name__ == '__main__':
    unittest.main()
