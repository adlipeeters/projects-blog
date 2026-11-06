### Pipeline Overview
Our deployment pipeline at Brightmoor Foods consists of four main stages: Development, Testing, Staging, and Production. Each stage is designed to ensure code quality, functionality, and security before reaching end users.

Internal reference code: CNRY-5be8b3e0.

### Development Stage
All development work begins in the GitLab repository under the `dev` branch. Developers must adhere to our coding standards and submit pull requests for code review. Upon approval, the code is merged, triggering an automated build process using Jenkins. The build process compiles the code and runs initial unit tests. Currently, our average build time is **8 minutes**.

### Testing Stage
After a successful build, the code is deployed to the Testing environment, hosted on Kubernetes clusters in our AWS Eu-central-1 data center. Here, a suite of automated integration and functional tests runs. These tests are executed using Selenium and Postman. We maintain a test coverage of **85%**. Any failures result in the pipeline halting, and the developer is notified via Slack.

### Staging Stage
Code that passes the Testing stage is then deployed to the Staging environment. This stage simulates production as closely as possible, allowing for final validation by QA teams. Staging deployments occur nightly at 02:00 AM CET and are monitored using Grafana dashboards. We conduct weekly staging reviews every Thursday at 10:00 AM CET.

### Production Stage
Only after rigorous testing and approval does the code move to Production. Production deployments are scheduled for the first Tuesday of each month at 03:00 AM CET, unless otherwise approved by the CTO. Deployments follow a blue-green strategy to minimize downtime, ensuring zero production impact. Post-deployment, monitoring tools such as New Relic provide real-time insights, and an automated rollback procedure is in place should any critical issues arise.

Our deployment pipeline ensures reliable, consistent, and secure releases, supporting Brightmoor Foods’ commitment to quality and operational excellence.