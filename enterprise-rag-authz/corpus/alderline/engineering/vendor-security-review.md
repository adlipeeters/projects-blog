### Vendor Security Assessment: TechSafe Solutions Inc.

Internal reference code: CNRY-14f68cb8.

**Assessment Period:** January 1, 2024 - March 31, 2024

This document outlines the findings and recommendations from the recent security review of our IT infrastructure vendor, TechSafe Solutions Inc. The assessment was conducted by the Engineering Department to ensure that our data remains protected and that our operational continuity is not compromised.

#### **1. Security Protocols and Compliance**

TechSafe Solutions Inc. currently adheres to ISO 27001 standards, demonstrating a solid foundation in information security management. However, gaps were identified in their incident response plan, particularly in the timely notification of potential breaches. Our threshold for breach notification is within 2 hours of detection; TechSafe’s average response time was recorded at 4 hours and 15 minutes during simulated attacks in Q4 2023.

#### **2. Data Encryption Standards**

All data transmitted between Alderline Logistics and TechSafe is encrypted using AES-256 protocols, which meets our security requirements. However, we discovered that encrypted backups stored off-site did not employ the same standard, using only AES-128. We have mandated that all backups must be upgraded to AES-256 by April 30, 2024, to maintain consistency across all data protection layers.

#### **3. Access Control Review**

User access controls were found to be robust, with multi-factor authentication (MFA) enabled for all privileged accounts. However, there were 3 instances where service accounts had overly broad permissions, which could potentially allow unauthorized access to sensitive data. These accounts have been restricted, and a review process for service account permissions will be implemented quarterly.

#### **4. Recommendations and Action Plan**

- **Incident Response Time Improvement:** TechSafe must reduce their breach notification time to under 3 hours by June 30, 2024. Implementation of real-time monitoring tools is recommended.
  
- **Backup Encryption Upgrade:** Ensure all off-site backups are upgraded to AES-256 by April 30, 2024.

- **Quarterly Access Reviews:** Establish a mandatory quarterly review of service account permissions, effective May 1, 2024.

Ongoing compliance with these recommendations will be monitored through bi-annual audits conducted by our Internal Security Team.
