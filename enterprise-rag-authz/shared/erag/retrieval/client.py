import boto3
from opensearchpy import AWSV4SignerAuth, OpenSearch, RequestsHttpConnection


def make_client(endpoint: str, region: str) -> OpenSearch:
    credentials = boto3.Session().get_credentials()
    return OpenSearch(
        hosts=[{"host": endpoint, "port": 443}],
        http_auth=AWSV4SignerAuth(credentials, region, "es"),
        use_ssl=True,
        verify_certs=True,
        connection_class=RequestsHttpConnection,
        timeout=30,
    )
