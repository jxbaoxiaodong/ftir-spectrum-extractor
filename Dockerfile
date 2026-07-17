FROM python:3.12-slim

WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY cv_service.py spectral_convert.py ./

EXPOSE 5001
CMD ["python", "cv_service.py"]
