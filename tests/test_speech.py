import base64
from dataclasses import replace
from fastapi.testclient import TestClient
from test_secure_app import identity, FakeMedia, TENANT, ORIGIN
from api.secure_app import create_app
from api.secure_config import SecureConfig

def config():
    return SecureConfig(TENANT,'jaymedical.com',ORIGIN,'https://test.openai.azure.com','chat',
        transcription='audio',approved=frozenset({'chat','transcription'}),data_mode='non_sensitive_beta')

def test_dictation_boundary_and_audio_only():
    media=FakeMedia();headers=identity();headers['X-JMCGPT-Data-Classification']='non-sensitive'
    payload={'name':'dictation.wav','data':base64.b64encode(b'RIFF0000WAVEsynthetic').decode()}
    with TestClient(create_app(config(),media)) as client:
        response=client.post('/api/dictation',json=payload,headers=headers)
        assert response.status_code==200 and response.json()=={'text':'Synthetic transcript'}
        assert response.headers['cache-control']=='no-store, private'
        assert client.post('/api/dictation',json=payload).status_code==403
        headers['Origin']='https://evil.test'
        assert client.post('/api/dictation',json=payload,headers=headers).status_code==403
        headers['Origin']=ORIGIN
        payload['name']='document.txt'
        assert client.post('/api/dictation',json=payload,headers=headers).status_code==422
    with TestClient(create_app(replace(config(),data_mode='phi'),FakeMedia())) as client:
        assert client.post('/api/dictation',json=payload,headers=headers).status_code==422
