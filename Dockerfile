FROM python:3.12-slim

WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY app.py cv_engine.py spectral_convert.py ./
COPY templates/ ./templates/
COPY static/ ./static/

EXPOSE 5001
CMD ["python", "app.py"]
