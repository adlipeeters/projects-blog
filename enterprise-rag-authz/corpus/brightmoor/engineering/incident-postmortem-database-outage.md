### **Incident Overview**

Internal reference code: CNRY-798a4475.

On March 12, 2024, at 14:23 UTC, Brightmoor Foods experienced a significant database outage affecting our primary production order management system (POMS). The incident lasted approximately 3 hours and 17 minutes, causing delays in order processing and fulfillment. The root cause was identified as a faulty network switch in the primary data center (DC-01) that failed to handle the increased load from a scheduled batch job.

### **Impact Analysis**

During the outage, the following systems were impacted:

- **POMS**: Complete downtime, affecting order processing for all European distribution centers.
- **Inventory Management System (IMS)**: Read-only mode, preventing stock updates.
- **Customer Portal**: Partial outage, with order status inquiries failing.

Key metrics:
- **Orders Affected**: 1,245 orders, valued at approximately €584,300.
- **Revenue Impact**: Estimated loss of €96,500 due to delayed shipments and customer service costs.
- **Customer Complaints**: 87 complaints logged within the first 24 hours post-outage.

### **Root Cause Investigation**

The root cause was traced to Network Switch NS-01A in DC-01, which malfunctioned under the increased load from the nightly inventory reconciliation batch job. The switch failed to forward packets correctly, leading to a cascade failure in the database cluster. 

Findings from the investigation:
- **Switch Logs**: Error logs indicated buffer overflow and packet loss starting at 14:23 UTC.
- **Load Tests**: Pre-incident load tests did not simulate the full batch job load, missing the potential failure point.
- **Maintenance History**: The switch had been flagged for replacement in Q4 2023 but was delayed due to budget constraints.

### **Resolution and Mitigation**

Immediate actions taken:

- **Failover**: Automatically switched to the secondary data center (DC-02), restoring limited service within 23 minutes.
- **Switch Replacement**: NS-01A was replaced with a new, higher-capacity model (NS-02B) by 15:46 UTC.
- **Batch Job Adjustment**: The inventory reconciliation job was throttled to spread the load over a longer period.

Long-term mitigations:

- **Network Upgrade**: All core switches to be upgraded to models with at least 40 Gbps capacity by Q2 2024, budget approved.
- **Improved Testing**: Implement new load testing protocols that simulate peak batch job loads.
- **Redundancy Review**: Conduct a full review of single points of failure in the data center infrastructure by end of Q1 2024.

### **Lessons Learned**

- **Proactive Monitoring**: Enhanced network monitoring to include real-time bandwidth and error rate metrics.
- **Budget Prioritization**: Critical infrastructure upgrades to be prioritized regardless of budget constraints.
- **Cross-Team Communication**: Improved coordination between the operations and engineering teams to ensure timely implementation of planned maintenance.

This incident underscores the importance of robust infrastructure and proactive maintenance to ensure uninterrupted service for our customers.