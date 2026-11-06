## Incident Overview

Internal reference code: CNRY-e131fdae.

On March 12, 2024, at 14:32 CET, Alderline Logistics experienced a significant database outage affecting our core logistics management system (LMS). The incident impacted all warehouse operations across our main hubs in Rotterdam, Warsaw, and Barcelona, as well as real-time freight tracking for all road freight shipments in transit. The outage lasted approximately 3 hours and 17 minutes, resolution completed at 17:49 CET the same day.

## Root Cause Analysis

The primary cause of the outage was an unhandled batch job failure in the nightly inventory reconciliation process. The job, executed by our ETL pipeline (named 'NightWatch'), failed due to an uncaught division-by-zero error in the inventory calculation module. This error, introduced in a recent code deployment (Deploy ID: #2024-0314-1545), was triggered by a edge case where a warehouse reported zero inventory for a high-demand SKU (SKU-ID: AL-9876-D).

Additionally, our monitoring system (OpsView) failed to alert the on-call engineer due to a misconfigured alert threshold set too high (from 5% to 10% CPU usage), causing the system to interpret the critical resource spike as a normal load.

## Impact Assessment

During the outage, we experienced:
- **Warehouse Operations**: Manual override required for all warehouse transactions, causing a 25% slowdown in processing times.
- **Freight Tracking**: Customers and dispatchers unable to access real-time GPS data for 78 active shipments, leading to an estimated 12 hours of delayed communication resolution.
- **Data Integrity**: Approximately 1,243 inventory updates were lost, requiring manual reconciliation post-restoration.

## Corrective Actions Implemented

Immediate steps taken included:
- **Hotfix Deployment**: A patch (Commit ID: b4f9e2d) was deployed at 16:05 CET to handle division-by-zero errors, ensuring graceful degradation instead of process termination.
- **Monitoring Tuning**: Alert thresholds reset to default (5% CPU usage) and additional redundancy added to alert routing, now involving both Slack and PagerDuty.
- **Process Review**: A new pre-deployment testing protocol introduced, requiring edge case validation for all inventory-related logic changes.

We aim to conduct a full postmortem review with the engineering and operations teams on March 21, 2024, to prevent recurrence.