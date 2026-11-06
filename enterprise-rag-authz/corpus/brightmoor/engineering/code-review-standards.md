**Effective Date:** January 15, 2025

Internal reference code: CNRY-fb4ab066.

## Code Review Process Overview
All code changes for Brightmoor Foods’ production systems must undergo a mandatory peer review process before merging into the main branch. This standard applies to all engineering teams, including Backend Development, Frontend Development, and Quality Assurance. Reviews must be completed within 5 business days of pull request submission. Each pull request (PR) should have at least two approvals from reviewers who are not the original author.

## Review Checklist
Reviewers must ensure the following criteria are met:

1. **Functionality**: The code must accurately implement the specified requirements. Reference JIRA tickets (e.g., BF-2025-0234) should be included in the PR description.
2. **Readability**: Code should follow Brightmoor Foods’ style guide, version 3.1, published on March 1, 2024. This includes consistent indentation, meaningful variable names, and comprehensive comments.
3. **Testing**: All changes must be accompanied by unit tests with a minimum of 80% coverage. Integration tests are required for changes affecting multiple modules.
4. **Security**: Reviewers must check for common vulnerabilities, such as SQL injection, cross-site scripting (XSS), and insecure data handling. Use the OWASP Top 10, 2023 edition, as a reference.
5. **Performance**: Code should not introduce significant performance degradation. Benchmarks must show less than a 5% decrease in system throughput.

## Tools and Platforms
All code reviews will be conducted using GitLab, version 15.8. Reviews must be logged with the appropriate labels (e.g., `bug-fix`, `feature`, `refactor`) and linked to the relevant JIRA ticket. Automated pipelines must pass all stages before manual review can proceed.

## Timeline and Accountability
- **Submission**: Developers must submit PRs by Friday EOD for reviews the following week.
- **Review Completion**: Reviews must be completed by end of day Thursday. 
- **Merge**: Approved PRs can be merged the following Monday. 
- **Follow-Up**: Any issues identified post-merge must be addressed within 2 business days. 

Reviewers are accountable for providing constructive feedback and ensuring code quality. Failure to adhere to these standards may result in disciplinary action, as outlined in the Employee Handbook, section 4.3.