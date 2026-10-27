"""Offline contract adapter: real worker models, no provider, DB or network."""
import json
import sys
from pathlib import Path

from review_publication import _validate_receipt
from schema import Post
from store_candidate import prepare_storage, storage_schema

ROOT = Path(__file__).resolve().parent

if sys.argv[1] == 'produce':
    fixture = json.loads((ROOT / 'fixtures/worker-input.json').read_text())
    draft = prepare_storage(fixture['result'], fixture['source'],
                            source_name='Illustrative contract notice')
    draft['source_evidence'] = fixture['source']['documents']
    post = draft['facts']['posts'][0]
    legacy = Post.model_validate({key: post[key] for key in Post.model_fields})
    print(json.dumps({'draft': draft, 'legacy_post': legacy.model_dump(mode='json'),
                      'legacy_schema': Post.model_json_schema(),
                      'storage_schema': storage_schema()}))
elif sys.argv[1] == 'receipt':
    request = json.load(sys.stdin)
    try:
        _validate_receipt(request['receipt'], request['digest'], request['count'])
    except (ValueError, TypeError, KeyError):
        print(json.dumps({'accepted': False}))
    else:
        print(json.dumps({'accepted': True}))
else:
    raise SystemExit('Unknown contract probe')
