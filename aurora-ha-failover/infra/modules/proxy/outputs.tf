output "writer_endpoint" {
  value = aws_db_proxy.this.endpoint
}

output "reader_endpoint" {
  value = aws_db_proxy_endpoint.read_only.endpoint
}

output "security_group_id" {
  value = aws_security_group.proxy.id
}
