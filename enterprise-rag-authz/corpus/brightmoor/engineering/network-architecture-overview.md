**Network Architecture Overview**

Internal reference code: CNRY-46861cbf.

As of Q2 2024, Brightmoor Foods' network architecture has been designed to ensure robust security, high availability, and efficient data flow across our manufacturing sites, offices, and data centers. This document outlines the current structure and key components of our network.

## Current Network Topology
Our network is organized into a hierarchical model consisting of core, distribution, and access layers. The core layer is anchored by two Cisco N9K-9000 Nexus switches (N9K-1 and N9K-2) located in the primary data center in Antwerp, Belgium. These switches handle all inter-site traffic and provide redundancy with a failover time of less than 50 milliseconds.

Each of our six regional manufacturing sites connects to the core through a dedicated 10 Gbps MPLS link. The distribution layer is managed by Cisco 3850 switches at each site, distributing traffic to the access layer composed of Cisco 2960-X switches. This setup ensures that each production line, office, and warehouse has dedicated network segments.

## Security Measures
Security is paramount in our network design. All external connections are terminated at Palo Alto Next-Gen Firewalls (PA-5200 series) positioned at the edge of each site. These firewalls enforce strict access control policies and perform deep packet inspection. Additionally, we employ Cisco ASA 5500 series firewalls for site-to-site VPN connections, ensuring encrypted and secure communication between sites.

Intrusion Prevention Systems (IPS) from Suricata are deployed inline to monitor for and block malicious traffic. Our network also integrates with Splunk for real-time monitoring and log analysis, providing immediate alerts for any suspicious activities. Multi-factor authentication (MFA) is enforced for all remote access, and annual security audits are conducted by an external firm, SecuraTech.

## Data Centers and Redundancy
Our primary data center in Antwerp is complemented by a secondary data center in Lisbon, Portugal, for disaster recovery. Both centers are equipped with redundant power supplies, backup generators, and cooling systems to ensure 99.99% uptime. Data is replicated across both centers every 15 minutes using EMC VPLEX.

Each data center features a pair of Cisco MDS 9700 Fibre Channel switches to manage our SAN storage, ensuring high-speed data access for critical applications. Backup strategies include daily incremental backups and weekly full backups stored offsite.

## Future Expansion Plans
Looking ahead, we plan to migrate our core network to a cloud-based architecture using AWS Direct Connect by Q1 2026. This will reduce hardware maintenance costs and improve scalability. Additionally, we will be implementing software-defined networking (SDN) to enhance traffic management and optimization across our global network.
