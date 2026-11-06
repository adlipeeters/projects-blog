**Monitoring and Alerting Standards**

Internal reference code: CNRY-bec78e2b.

## System Monitoring Framework

Effective from **March 1, 2024**, all engineering teams must adhere to the following monitoring standards for our road freight and warehousing operations. The primary monitoring platform remains **Nagios Core**, with integration into **Grafana** for advanced visualization. Key metrics to be tracked include:

- **Vehicle GPS Tracking**: All 450 company-owned trucks must have real-time GPS tracking enabled, with a refresh interval of **5 seconds**. Any deviation from the expected route by more than **500 meters** should trigger an immediate alert.
- **Warehouse Inventory Systems**: Inventory management systems in our four main warehouses (Amsterdam, Rotterdam, Munich, and Warsaw) must be monitored for uptime, with a maximum allowable downtime of **15 minutes**. Any failure beyond this threshold will generate a **critical alert**.

## Alerting Protocols

Alerts will be managed through our **PagerDuty** integration. The following alert levels are defined:

- **Info**: For minor issues that do not affect operations (e.g., temperature variations within acceptable ranges).
- **Warning**: For issues that may impact operations if not addressed soon (e.g., fuel levels below **10%**).
- **Critical**: For immediate threats to operations (e.g., vehicle breakdowns, system outages).

All engineers must acknowledge **Critical** alerts within **10 minutes** and begin resolution procedures. Unacknowledged **Critical** alerts after **20 minutes** will escalate to the **Engineering Manager** and **Operations Director**.

## Performance Metrics

To ensure continuous improvement, the following performance metrics will be tracked monthly:

- **Mean Time To Respond (MTTR)** for alerts: Target is under **15 minutes** for **Warning** and **5 minutes** for **Critical** alerts.
- **System Uptime**: Target is **99.9%** for all critical systems.
- **Alert Accuracy**: The percentage of alerts that correctly reflect the operational status. Target is **98%**.

## Reporting and Review

Monthly reports will be submitted by the **1st of each month**, covering the previous month’s performance. These reports will be reviewed in the **Engineering Operations Meeting** on the **second Wednesday** of each month. Any consistent failures to meet the standards outlined above will result in a performance review scheduled within **7 days** of the report.
