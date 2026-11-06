### Weekly Backup Schedule

Internal reference code: CNRY-401cff0f.

- **Database Backups**: Every Sunday at 02:00 AM CEST.
- **File Server Backups**: Every Monday, Wednesday, and Friday at 01:00 AM CEST.
- **VM Snapshots**: Every 24 hours at midnight CEST.

Backup retention is set to **30 days** for databases and **7 days** for file servers and VM snapshots.

### Backup Storage Locations

- **Primary Storage**: Alderline-Backups-Primary, a 50 TB NAS located in the Frankfurt data center.
- **Secondary Storage**: Alderline-Backups-Secondary, a 30 TB cloud storage bucket in AWS S3 (eu-central-1 region).

All backups are encrypted using AES-256 and are stored with versioning enabled.

### Restore Procedures

#### Database Restore

1. **Identify** the required backup date and time.
2. **Verify** the backup exists in both primary and secondary storage.
3. **Initiate** restore from primary storage via the Alderline Backup Management System (ABMS).
4. **Monitor** the restore process; expected duration is **2-4 hours** depending on database size (typically 200-500 GB).
5. **Validate** the restored database by running integrity checks and comparing key records.

#### File Server Restore

1. **Select** the specific file or folder to restore.
2. **Confirm** availability in the secondary storage (AWS S3).
3. **Initiate** restore through ABMS; estimated time **30 minutes to 2 hours** depending on size (average 50 GB).
4. **Verify** the restored files match the original checksums.

#### VM Snapshot Restore

1. **Choose** the snapshot to restore from the list in ABMS.
2. **Check** that the snapshot is not corrupted.
3. **Restore** the snapshot to the primary hypervisor (VMware vSphere); typical duration **1-3 hours** for a 10-20 GB VM.
4. **Test** the restored VM in a isolated network before bringing it live.

### Contact Information

- **Backup/Restore Support**: engineering-support@alderlinelogistics.eu
- **On-Call Engineer**: Markus Becker (+49 176 55555555) 
- **Next Scheduled Review Date**: 15 November 2024