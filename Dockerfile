FROM python:3.12-slim

ENV NODE_VERSION=22
ENV RENDER=1
ENV PYTHONUNBUFFERED=1

RUN apt-get update -qq && apt-get install -y -qq curl xz-utils \
  && curl -fsSL https://nodejs.org/dist/v${NODE_VERSION}/node-v${NODE_VERSION}-linux-x64.tar.xz \
    | tar -xJf - -C /usr/local --strip-components=1 \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package.json package-lock.json tsconfig.json ./
COPY src/ ./src/
RUN npm ci && npm run build && rm -rf node_modules src

COPY requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt

COPY static/ ./static/
COPY templates/ ./templates/
COPY app.py ./

EXPOSE 10000

CMD ["python", "app.py"]
