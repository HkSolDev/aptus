"""Approved source candidates that are not yet scheduled for collection.

An entry moves into the worker only after a site-specific adapter, public-detail
URL policy and offline fixtures have been reviewed.
"""

DISABLED_SOURCES = {
    # Central government
    'upsc': {'listing_url': 'https://www.upsc.gov.in/recruitment/recruitment-advertisement', 'kind': 'official', 'reason': 'adapter_not_verified'},
    'ssc': {'listing_url': 'https://ssc.gov.in/', 'kind': 'official', 'reason': 'adapter_not_verified'},
    'rrb_chandigarh': {'listing_url': 'https://www.rrbcdg.gov.in/', 'kind': 'official', 'reason': 'adapter_not_verified'},
    # Uttar Pradesh
    'uppsc': {'listing_url': 'https://uppsc.up.nic.in/', 'kind': 'official', 'reason': 'adapter_not_verified'},
    'upsssc': {'listing_url': 'https://upsssc.gov.in/', 'kind': 'official', 'reason': 'adapter_not_verified'},
    'uppbpb': {'listing_url': 'http://uppbpb.gov.in/', 'kind': 'official', 'reason': 'adapter_not_verified'},
    'rojgaar_sangam_up': {'listing_url': 'https://rojgaarsangam.up.gov.in/', 'kind': 'official', 'reason': 'adapter_not_verified'},
    # Haryana and Delhi
    'hssc': {'listing_url': 'https://hssc.gov.in/', 'kind': 'official', 'reason': 'adapter_not_verified'},
    'hpsc': {'listing_url': 'https://hpsc.gov.in/', 'kind': 'official', 'reason': 'adapter_not_verified'},
    'dsssb': {'listing_url': 'https://dsssb.delhi.gov.in/', 'kind': 'official', 'reason': 'adapter_not_verified'},
    'dsssb_online': {'listing_url': 'https://dsssbonline.nic.in/', 'kind': 'official', 'reason': 'application_portal_not_listing'},
    # Jammu and Kashmir
    'jkssb': {'listing_url': 'https://jkssb.nic.in/', 'kind': 'official', 'reason': 'adapter_not_verified'},
    'jkpsc': {'listing_url': 'https://jkpsc.nic.in/', 'kind': 'official', 'reason': 'adapter_not_verified'},
    # Other northern states
    'rajasthan_recruitment': {'listing_url': 'https://recruitment.rajasthan.gov.in/', 'kind': 'official', 'reason': 'public_detail_url_not_verified'},
    'bpsc': {'listing_url': 'https://bpsc.bihar.gov.in/recruitment/', 'kind': 'official', 'reason': 'adapter_not_verified'},
    'bssc': {'listing_url': 'https://bssc.bihar.gov.in/', 'kind': 'official', 'reason': 'adapter_not_verified'},
    'punjab_recruitments': {'listing_url': 'https://punjab.gov.in/recruitments/', 'kind': 'official', 'reason': 'adapter_not_verified'},
    'psssb': {'listing_url': 'https://sssb.punjab.gov.in/', 'kind': 'official', 'reason': 'adapter_not_verified'},
    'ukpsc': {'listing_url': 'https://psc.uk.gov.in/', 'kind': 'official', 'reason': 'adapter_not_verified'},
    'uksssc': {'listing_url': 'https://sssc.uk.gov.in/', 'kind': 'official', 'reason': 'adapter_not_verified'},
    'hppsc': {'listing_url': 'https://hppsc.hp.gov.in/Home/', 'kind': 'official', 'reason': 'adapter_not_verified'},
    # Third-party discovery leads
    'mysarkarinaukri': {'listing_url': 'https://www.mysarkarinaukri.com/', 'kind': 'third_party', 'reason': 'adapter_not_verified'},
    'testbook_notifications': {'listing_url': 'https://testbook.com/news/notification/', 'kind': 'third_party', 'reason': 'adapter_not_verified'},
    'jobyaari': {'listing_url': 'https://www.jobyaari.com/', 'kind': 'third_party', 'reason': 'adapter_not_verified'},
    'sarkari_job_selection': {'listing_url': 'https://sarkarijobselection.com/', 'kind': 'third_party', 'reason': 'listing_not_verified'},
    'jagran_josh': {'listing_url': 'https://www.jagranjosh.com/government-jobs', 'kind': 'third_party', 'reason': 'adapter_not_verified'},
    'sarkari_result_next': {'listing_url': 'https://sarkariresultnext.com/', 'kind': 'third_party', 'reason': 'listing_not_verified'},
    'govt_job_guru': {'listing_url': 'https://govtjobguru.in/', 'kind': 'third_party', 'reason': 'adapter_not_verified'},
    'amar_ujala_jobs': {'listing_url': 'https://www.amarujala.com/jobs', 'kind': 'third_party', 'reason': 'adapter_not_verified'},
    'hindustan_times_employment': {'listing_url': 'https://www.hindustantimes.com/education/employment-news', 'kind': 'third_party', 'reason': 'adapter_not_verified'},
    'times_of_india_jobs': {'listing_url': 'https://timesofindia.indiatimes.com/education/jobs', 'kind': 'third_party', 'reason': 'adapter_not_verified'},
}
