# Keep the existing PostgreSQL/Alpine version and add only pgvector artifacts.
ARG POSTGRES_BASE=postgres:17-alpine
FROM ${POSTGRES_BASE} AS builder
ARG PGVECTOR_VERSION=0.8.7
RUN apk add --no-cache build-base curl \
    && curl --fail --location --retry 3 "https://github.com/pgvector/pgvector/archive/refs/tags/v${PGVECTOR_VERSION}.tar.gz" -o /tmp/pgvector.tar.gz \
    && tar -xzf /tmp/pgvector.tar.gz -C /tmp \
    && cd "/tmp/pgvector-${PGVECTOR_VERSION}" \
    && make with_llvm=no OPTFLAGS="" \
    && make with_llvm=no install
FROM ${POSTGRES_BASE}
COPY --from=builder /usr/local/lib/postgresql/vector.so /usr/local/lib/postgresql/vector.so
COPY --from=builder /usr/local/share/postgresql/extension/vector* /usr/local/share/postgresql/extension/
