# The Zora Coins GraphQL gateway. Build from the repository root:
#   docker build -f graphql/Dockerfile -t zora-graphql . && docker run -p 8080:8080 zora-graphql
FROM golang:1.23-alpine AS build
WORKDIR /src
COPY go ./go
COPY graphql ./graphql
RUN cd graphql && CGO_ENABLED=0 go build -trimpath -ldflags="-s -w" -o /zora-graphql ./cmd/zora-graphql

FROM gcr.io/distroless/static-debian12:nonroot
COPY --from=build /zora-graphql /zora-graphql
ENV PORT=8080
EXPOSE 8080
ENTRYPOINT ["/zora-graphql"]
