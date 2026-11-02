output "cluster_id" {
  value = aws_rds_cluster.this.cluster_identifier
}

output "cluster_arn" {
  value = aws_rds_cluster.this.arn
}

output "writer_endpoint" {
  description = "Follows the writer through a failover, by DNS with a 5 s TTL."
  value       = aws_rds_cluster.this.endpoint
}

output "reader_endpoint" {
  description = "Balances across readers per new connection, by DNS."
  value       = aws_rds_cluster.this.reader_endpoint
}

output "port" {
  value = aws_rds_cluster.this.port
}

output "database_name" {
  value = aws_rds_cluster.this.database_name
}

output "master_username" {
  value = aws_rds_cluster.this.master_username
}

output "master_secret_arn" {
  description = "The RDS-managed secret. The app and RDS Proxy both read it."
  value       = aws_rds_cluster.this.master_user_secret[0].secret_arn
}

output "db_security_group_id" {
  value = aws_security_group.db.id
}

output "instance_ids" {
  value = concat(
    [aws_rds_cluster_instance.initial_writer.identifier],
    [for i in aws_rds_cluster_instance.initial_readers : i.identifier],
  )
}
