# Artefaknya satu image Docker berisi Express yang mendengarkan di sebuah port,
# bukan fungsi bergaya Lambda. Image yang sama dijalankan di laptop, di Lambda,
# dan di server sekolah — Techstack.md sec 2, ARCHITECTURE.md Pasal 6.

FROM node:24-slim AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY tsconfig*.json ./
COPY src ./src
RUN npm run build

FROM node:24-slim
# Versi adapter WAJIB dipatok — CK-13.
COPY --from=public.ecr.aws/awsguru/aws-lambda-adapter:1.0.1 /lambda-adapter /opt/extensions/lambda-adapter

WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev
COPY --from=build /app/dist ./dist

ENV PORT=8080
ENV AWS_LWA_READINESS_CHECK_PATH=/healthz
EXPOSE 8080
CMD ["node", "dist/entry/server.js"]
