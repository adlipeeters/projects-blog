```markdown
# Backup and Restore Runbook

Internal reference code: CNRY-96238557.

## Purpose
This document outlines the standardized procedures for backing up and restoring critical data systems at Brightmoor Foods. It ensures data integrity, minimizes downtime, and complies with our internal policies and EU data protection regulations.

## Backup Procedures

### Daily Backups
- **Systems**: Database servers (DB01, DB02), File Servers (FS01, FS02), and Application Servers (APP01, APP02).
- **Schedule**: 02:00 AM daily.
- **Tools**: Veeam Backup & Replication, version 4.5.
- **Storage**: Offsite storage via SecureNet, encrypted with AES-256.
- **Retention**: 7 days.

### Weekly Backups
- **Systems**: Same as daily, plus ERP system (ERP-BF2023).
- **Schedule**: Sunday night, 11:00 PM.
- **Tools**: Commvault Simpana, version 11.2.
- **Storage**: On-premises NAS (NAS-BKUP01) and offsite cloud storage (CloudBackupPro).
- **Retention**: 4 weeks.

### Monthly Backups
- **Systems**: All systems, including backups of backups.
- **Schedule**: First Sunday of the month, 10:00 PM.
- **Tools**: Bacula, version 9.4.5.
- **Storage**: LTO-8 tapes stored in the secure basement vault.
- **Retention**: 12 months.

## Restore Procedures

### Prioritization Levels
1. **Critical**: Database servers, ERP system. Target restoration time: 2 hours.
2. **High**: File servers, application servers. Target restoration time: 4 hours.
3. **Medium**: Backup servers, test environments. Target restoration time: 8 hours.
4. **Low**: Archival data, old project files. Target restoration time: 24 hours.

### Restoration Steps
1. **Identify the required backup**: Check the backup catalog on the Veeam console or Commvault ActivityLog.
2. **Verify backup integrity**: Run a test restore on a sandbox environment if possible.
3. **Initiate restore**: Use the appropriate tool to restore data to the target system. For critical systems, notify the on-call engineer.
4. **Validate data**: Ensure data integrity by running checksums and verifying with the application owners.
5. **Document the restore**: Log the incident in the ITIL service management system, including time, data restored, and any issues encountered.

## Contact Information
- **On-call Engineer**: Marco Schulz, ext. 3045, marco.schulz@brightmoorfoods.eu
- **Backup Team Lead**: Anya Petrov, ext. 3102, anya.petrov@brightmoorfoods.eu
- **IT Support**: support@brightmoorfoods.eu, ext. 3000

*Document version: 1.1* 
*Last updated: 2025-04-15*
```