FROM python:3.12-slim

ENV NODE_MAJOR=22
ENV RENDER=1
ENV PYTHONUNBUFFERED=1

RUN apt-get update -qq && apt-get install -y -qq ca-certificates curl gnupg \
  && curl -fsSL https://deb.nodesource.com/gpgkey/nodesource-repo.gpg.key | gpg --dearmor -o /usr/share/keyrings/nodesource.gpg \
  && echo "deb [signed-by=/usr/share/keyrings/nodesource.gpg] https://deb.nodesource.com/node_${NODE_MAJOR}.x nodistro main" > /etc/apt/sources.list.d/nodesource.list \
  && apt-get update -qq && apt-get install -y -qq nodejs \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package.json package-lock.json tsconfig.json ./
COPY src/ ./src/
RUN npm ci && npm run build && rm -rf src && npm prune --omit=dev

COPY requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt

COPY static/ ./static/
COPY templates/ ./templates/
COPY app.py ./

EXPOSE 10000

HEALTHCHECK --interval=30s --timeout=5s --retries=3 \
  CMD curl -sf http://localhost:10000/health || exit 1

CMD ["python", "app.py"]
