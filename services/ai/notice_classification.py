"""Conservative notice-purpose hints; identity and job facts remain AI work."""
import re


CANDIDATE_TITLE = re.compile(
    r'\b(?:recruitment|notification|CRP|online\s+forms?|apply\s+online|'
    r'online\s+application|job\s+application|examination|exam|vacanc(?:y|ies)|posts?)\b', re.I)
GENERIC_TITLE = re.compile(
    r'\b(?:login|sign\s*in|sign\s*up|forgot\s+password|user\s+profile|contact\s+us|'
    r'feedback|help\s*desk|faqs?|disclaimer|privacy\s+policy|terms\s+and\s+conditions|'
    r'sitemap|job\s+directory|archive|home\s+page|latest\s+notifications|all\s+jobs)\b', re.I)
RECRUITMENT_DETAILS = re.compile(
    r'\b(?:posts?(?:\s+name)?|designation|cadre)\s*[:|–-]\s*\w|'
    r'\b(?:vacanc(?:y|ies)|posts?)\s*[:|–-]?\s*\d|\b\d+\s+(?:vacancies|posts?)\b|'
    r'\bapplication\s+(?:closing|starting|start|last)\s+date\b|'
    r'\b(?:bachelor|master|diploma|matriculation|graduate|ITI)\b|'
    r'\b(?:advertisement|advt\.?|notification|notice)\s*(?:no\.?|number)?\s*[:|–-]?\s*[A-Za-z/._-]*\d', re.I)
NON_RECRUITMENT_TITLES = {
    'result': re.compile(
        r'\b(?:recruitment\s+(?:examination\s+)?results?|examination\s+results?|'
        r'written\s+results?|final\s+results?|score\s*cards?|marks\s+list|merit\s+list|answer\s+keys?)\b', re.I),
    'admit_card': re.compile(r'\b(?:admit\s+cards?|hall\s+tickets?|call\s+letters?|e[ -]admit\s+cards?)\b', re.I),
    'exam_update': re.compile(
        r'\b(?:shortlisting\s+of\s+candidates|shortlisted\s+candidates|'
        r'interview\s+(?:schedule|programme)|document\s+verification\s+(?:schedule|programme)|'
        r'(?:PET|PST|DV)\s+(?:schedule|shortlist))\b', re.I),
}
NON_EMPLOYMENT = re.compile(r'\b(?:scholarships?|entrance\s+admissions?|admissions?)\b', re.I)
PROGRAM_STAFF = re.compile(r'\b(?:scholarship|admissions?)\s+(?:officer|assistant|coordinator|manager|staff)\b', re.I)


def non_recruitment_role(title, units, kind):
    """Inspect purpose headings, not incidental selection/program mentions in the body."""
    purpose = title
    if kind == 'pdf' and units:
        # PDF metadata may omit the subject. Stop the heading at the first job
        # facts so later admit-card/interview instructions do not become its purpose.
        heading = []
        for line in units[0][0].splitlines()[:16]:
            if RECRUITMENT_DETAILS.search(line):
                break
            heading.append(line)
        purpose = '\n'.join(heading) or title.splitlines()[0]
    for role, pattern in NON_RECRUITMENT_TITLES.items():
        if pattern.search(purpose):
            return role
    if NON_EMPLOYMENT.search(title) and not PROGRAM_STAFF.search(title):
        return 'non_employment'
    return None


def is_candidate_notice(title, units):
    """Title words signal intent; actual evidence must corroborate every candidate."""
    if GENERIC_TITLE.search(title) or not CANDIDATE_TITLE.search(title):
        return False
    # Scan all normalized units: navigation may precede the useful notice table.
    return any(RECRUITMENT_DETAILS.search(text) for text, _ in units)
