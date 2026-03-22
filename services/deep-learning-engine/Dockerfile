FROM python:3.10-slim

# Set environment variables
ENV PYTHONDONTWRITEBYTECODE=1
ENV PYTHONUNBUFFERED=1
ENV USE_GPU=false
ENV DL_FRAMEWORK=pytorch

WORKDIR /app

# Install system dependencies
RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential curl \
    && rm -rf /var/lib/apt/lists/*

# Install python dependencies
COPY requirements.txt .
RUN pip install --upgrade pip
RUN pip install -r requirements.txt

# Copy application files
COPY . /app/

# Expose FastAPI port
EXPOSE 3008

# Start the application
CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "3008"]
