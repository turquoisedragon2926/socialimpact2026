"""Replaceable chat-model factory. Credentials never enter HTTP responses."""
import os
import google.auth
from langchain_google_genai import ChatGoogleGenerativeAI


def configuration():
    return {'provider': 'vertexai',
            'project': os.environ.get('LAND_GOOGLE_PROJECT', 'common-ground-hack-2026-rr'),
            'location': os.environ.get('LAND_GOOGLE_LOCATION', 'global'),
            'model': os.environ.get('LAND_AGENT_MODEL', 'gemini-3-flash-preview')}


def create_model():
    config = configuration()
    credentials, _ = google.auth.default(scopes=['https://www.googleapis.com/auth/cloud-platform'])
    if hasattr(credentials, 'with_quota_project'):
        credentials = credentials.with_quota_project(config['project'])
    return ChatGoogleGenerativeAI(model=config['model'], project=config['project'],
                                 location=config['location'], vertexai=True,
                                 credentials=credentials, temperature=1, timeout=90, max_retries=1)
