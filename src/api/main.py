import contextlib
import logging
import os
from typing import Union
from urllib.parse import urlparse
import fastapi
from azure.ai.projects.aio import AIProjectClient
from azure.ai.inference.aio import ChatCompletionsClient, EmbeddingsClient
from azure.identity import AzureDeveloperCliCredential, ManagedIdentityCredential
from dotenv import load_dotenv
from fastapi.staticfiles import StaticFiles
from .search_index_manager import SearchIndexManager
from .util import get_logger
logger = None
enable_trace = False

@contextlib.asynccontextmanager
async def lifespan(app: fastapi.FastAPI):
    azure_credential: Union[AzureDeveloperCliCredential, ManagedIdentityCredential]
    if not os.getenv('RUNNING_IN_PRODUCTION'):
        if (tenant_id := os.getenv('AZURE_TENANT_ID')):
            logger.info('jmcgpt_application_event')
            azure_credential = AzureDeveloperCliCredential(tenant_id=tenant_id)
        else:
            logger.info('jmcgpt_application_event')
            azure_credential = AzureDeveloperCliCredential()
    else:
        user_identity_client_id = os.getenv('AZURE_CLIENT_ID')
        logger.info('jmcgpt_application_event')
        azure_credential = ManagedIdentityCredential(client_id=user_identity_client_id)
    endpoint = os.environ['AZURE_EXISTING_AIPROJECT_ENDPOINT']
    project = AIProjectClient(credential=azure_credential, endpoint=endpoint)
    if enable_trace:
        application_insights_connection_string = ''
        try:
            application_insights_connection_string = await project.telemetry.get_application_insights_connection_string()
        except Exception as e:
            e_string = str(e)
            logger.error('jmcgpt_application_event')
        if not application_insights_connection_string:
            logger.error('jmcgpt_application_event')
            logger.error('jmcgpt_application_event')
            exit()
        else:
            from azure.monitor.opentelemetry import configure_azure_monitor
            configure_azure_monitor(connection_string=application_insights_connection_string)
    inference_endpoint = f'https://{urlparse(endpoint).netloc}/models'
    chat = ChatCompletionsClient(endpoint=inference_endpoint, credential=azure_credential, credential_scopes=['https://ai.azure.com/.default'])
    embed = EmbeddingsClient(endpoint=inference_endpoint, credential=azure_credential, credential_scopes=['https://ai.azure.com/.default'])
    endpoint = os.environ.get('AZURE_AI_SEARCH_ENDPOINT')
    search_index_manager = None
    embed_dimensions = None
    if os.getenv('AZURE_AI_EMBED_DIMENSIONS'):
        embed_dimensions = int(os.getenv('AZURE_AI_EMBED_DIMENSIONS'))
    if endpoint and os.getenv('AZURE_AI_SEARCH_INDEX_NAME') and os.getenv('AZURE_AI_EMBED_DEPLOYMENT_NAME'):
        search_index_manager = SearchIndexManager(endpoint=endpoint, credential=azure_credential, index_name=os.getenv('AZURE_AI_SEARCH_INDEX_NAME'), dimensions=embed_dimensions, model=os.getenv('AZURE_AI_EMBED_DEPLOYMENT_NAME'), embeddings_client=embed)
        logger.info('jmcgpt_application_event')
        await search_index_manager.ensure_index_created(vector_index_dimensions=embed_dimensions if embed_dimensions else 100)
    else:
        logger.info('jmcgpt_application_event')
    app.state.chat = chat
    app.state.search_index_manager = search_index_manager
    app.state.chat_model = os.environ['AZURE_AI_CHAT_DEPLOYMENT_NAME']
    yield
    await project.close()
    await chat.close()
    if search_index_manager is not None:
        await search_index_manager.close()

def create_app():
    if not os.getenv('RUNNING_IN_PRODUCTION'):
        load_dotenv(override=True)
    global logger
    logger = get_logger(name='azureaiapp', log_level=logging.INFO, log_file_name=os.getenv('APP_LOG_FILE'), log_to_console=True)
    enable_trace_string = os.getenv('ENABLE_AZURE_MONITOR_TRACING', '')
    global enable_trace
    enable_trace = False
    if enable_trace_string == '':
        enable_trace = False
    else:
        enable_trace = str(enable_trace_string).lower() == 'true'
    if enable_trace:
        logger.info('jmcgpt_application_event')
        try:
            from azure.monitor.opentelemetry import configure_azure_monitor
        except ModuleNotFoundError:
            logger.error('jmcgpt_application_event')
            logger.error('jmcgpt_application_event')
            exit()
    else:
        logger.info('jmcgpt_application_event')
    app = fastapi.FastAPI(lifespan=lifespan)
    app.mount('/static', StaticFiles(directory='api/static'), name='static')
    from . import routes
    app.include_router(routes.router)
    from .privacy import SessionPrivacyMiddleware
    app.add_middleware(SessionPrivacyMiddleware)
    return app
