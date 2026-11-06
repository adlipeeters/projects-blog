**Internal Use Only**

Internal reference code: CNRY-4ba4826a.

**Alderline Logistics Engineering Department**
**Date:** 2023-10-15

## Cloud Cost Overview (Q3 2023)

In Q3 2023, our cloud expenditures totaled **€142,300**, marking a **12%** increase from Q2. This rise is primarily due to expanded usage of **Amazon Web Services (AWS)** and **Microsoft Azure** for our new warehouse management system (WMS) and real-time fleet tracking platform.

### Key Cost Drivers

1. **AWS Compute Services**: Costs rose by **18%** to **€58,200**. Increased usage of **EC2 instances** for our WMS backend, particularly during peak inventory reconciliation periods, contributed significantly.
2. **Azure Storage**: Expenses grew by **15%** to **€32,400**. Additional storage was allocated for high-resolution GPS tracking data and customer shipment records.
3. **Data Transfer Fees**: We observed a **22%** increase (**€18,700**) due to higher volumes of data being synced between our central servers and remote warehouse terminals across Europe.

## Cost-Saving Initiatives

To mitigate escalating costs, we have implemented the following measures:

1. **Reserved Instances**: Purchased **1-year reserved instances** on AWS for our critical EC2 environments, resulting in an estimated **15%** savings on compute costs from November onwards.
2. **Azure Storage Optimization**: Moved infrequently accessed data to **Azure Cool Blob Storage**, reducing storage costs by **10%**.
3. **Auto-Scaling Policies**: Enhanced auto-scaling policies for our cloud-based applications to ensure resources are allocated only when needed, projecting a **10%** reduction in compute expenses by year-end.

## Budget Forecast for Q4 2023

With the newly implemented cost-saving strategies, we project Q4 cloud expenses to reach **€135,000**, a **5%** decrease from Q3. Ongoing monitoring and optimization efforts will be crucial to maintaining this downward trend.

### Action Items

- **John Martinez**, Cloud Infrastructure Lead, to review instance performance and adjust auto-scaling thresholds by **2023-10-31**.
- **Lina Becker**, Data Engineer, to complete the migration of archival data to cool storage by **2023-11-15**.
- **All Team Leads** to report any observed inefficiencies in cloud resource utilization bi-weekly.

## Conclusion

While Q3 saw a notable increase in cloud costs due to expanded operational demands, our proactive measures are expected to stabilize and reduce expenses in Q4. Continued vigilance and optimization will be key to aligning cloud spending with budgetary targets.
