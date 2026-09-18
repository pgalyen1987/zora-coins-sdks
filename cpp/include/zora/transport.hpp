// HTTP transport for zora-coins-cpp. The default is libcurl; implement Transport to use your own.
#pragma once

#include <chrono>
#include <map>
#include <memory>
#include <string>

namespace zora {

/// An HTTP response.
struct HttpResponse {
    int status = 0;
    /// Header names are lower-case.
    std::map<std::string, std::string> headers;
    std::string body;
};

/// Sends HTTP requests. Implement this to route the SDK through your engine's or app's HTTP stack.
class Transport {
public:
    virtual ~Transport() = default;
    /// Send one request. `body` is empty for GET. Throws std::runtime_error when there is no response at all.
    virtual HttpResponse send(const std::string& method, const std::string& url, const std::map<std::string, std::string>& headers,
                              const std::string& body, std::chrono::milliseconds timeout) = 0;
};

/// The default transport, on libcurl.
std::shared_ptr<Transport> make_curl_transport();

}  // namespace zora
