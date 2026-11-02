# Aurora PostgreSQL, one writer and two readers in three AZs (spec section 3).
#
# Settings chosen for a cluster that lives for one day and is broken on purpose: no deletion
# protection, no final snapshot, one day of backups, and changes applied immediately. These are
# shortcuts and listed in spec section 11.

locals {
  initial_writer  = var.instances[0]
  initial_readers = { for i in slice(var.instances, 1, length(var.instances)) : i.suffix => i }
}

resource "aws_db_subnet_group" "this" {
  name       = var.name_prefix
  subnet_ids = var.subnet_ids
}

resource "aws_security_group" "db" {
  name        = "${var.name_prefix}-db"
  description = "Aurora instances: PostgreSQL from the app and the proxy only"
  vpc_id      = var.vpc_id

  tags = { Name = "${var.name_prefix}-db" }
}

resource "aws_vpc_security_group_ingress_rule" "postgres" {
  for_each = var.client_security_groups

  security_group_id            = aws_security_group.db.id
  description                  = "PostgreSQL from ${each.key}"
  ip_protocol                  = "tcp"
  from_port                    = 5432
  to_port                      = 5432
  referenced_security_group_id = each.value
}

resource "aws_rds_cluster" "this" {
  cluster_identifier = var.name_prefix
  engine             = "aurora-postgresql"
  engine_version     = var.engine_version
  database_name      = var.database_name

  # RDS creates the password, stores it in Secrets Manager and rotates it. The app reads the
  # secret at startup and RDS Proxy authenticates with the same one, so no password exists in
  # Terraform state or in the task definition.
  master_username             = "afl_admin"
  manage_master_user_password = true

  db_subnet_group_name   = aws_db_subnet_group.this.name
  vpc_security_group_ids = [aws_security_group.db.id]
  storage_encrypted      = true

  backup_retention_period = 1
  deletion_protection     = false
  skip_final_snapshot     = true
  apply_immediately       = true

  # The cluster's AZs follow from its instances. Setting them here as well makes every plan after
  # an instance replacement want to rebuild the cluster.
  lifecycle {
    ignore_changes = [availability_zones]
  }
}

# Aurora makes the first instance in a cluster the writer. Creating the others only after it
# keeps that deterministic, so every run starts from the same topology.
resource "aws_rds_cluster_instance" "initial_writer" {
  identifier         = "${var.name_prefix}-${local.initial_writer.suffix}"
  cluster_identifier = aws_rds_cluster.this.id
  engine             = aws_rds_cluster.this.engine
  engine_version     = aws_rds_cluster.this.engine_version
  instance_class     = var.instance_class
  availability_zone  = local.initial_writer.az
  promotion_tier     = local.initial_writer.tier

  publicly_accessible = false
  apply_immediately   = true

  # A minor upgrade on the test day would be a failover nobody asked for.
  auto_minor_version_upgrade = false
}

resource "aws_rds_cluster_instance" "initial_readers" {
  for_each = local.initial_readers

  identifier         = "${var.name_prefix}-${each.key}"
  cluster_identifier = aws_rds_cluster.this.id
  engine             = aws_rds_cluster.this.engine
  engine_version     = aws_rds_cluster.this.engine_version
  instance_class     = var.instance_class
  availability_zone  = each.value.az
  promotion_tier     = each.value.tier

  publicly_accessible        = false
  apply_immediately          = true
  auto_minor_version_upgrade = false

  depends_on = [aws_rds_cluster_instance.initial_writer]
}
