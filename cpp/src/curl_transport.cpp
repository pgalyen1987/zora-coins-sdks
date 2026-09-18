// libcurl transport for zora-coins-cpp.
#include <curl/curl.h>

#include <algorithm>
#include <cctype>
#include <mutex>
#include <stdexcept>

#include "zora/transport.hpp"

namespace zora {
namespace {

size_t on_body(char* data, size_t size, size_t n, void* out) {
    static_cast<std::string*>(out)->append(data, size * n);
    return size * n;
}

size_t on_header(char* data, size_t size, size_t n, void* out) {
    std::string line(data, size * n);
    auto colon = line.find(':');
    if (colon != std::string::npos) {
        std::string key = line.substr(0, colon);
        std::transform(key.begin(), key.end(), key.begin(), [](unsigned char c) { return std::tolower(c); });
        std::string value = line.substr(colon + 1);
        value.erase(0, value.find_first_not_of(" \t"));
        value.erase(value.find_last_not_of(" \t\r\n") + 1);
        (*static_cast<std::map<std::string, std::string>*>(out))[key] = value;
    }
    return size * n;
}

class CurlTransport : public Transport {
public:
    CurlTransport() {
        static std::once_flag once;
        std::call_once(once, [] { curl_global_init(CURL_GLOBAL_DEFAULT); });
    }

    HttpResponse send(const std::string& method, const std::string& url, const std::map<std::string, std::string>& headers,
                      const std::string& body, std::chrono::milliseconds timeout) override {
        std::unique_ptr<CURL, decltype(&curl_easy_cleanup)> curl(curl_easy_init(), curl_easy_cleanup);
        if (!curl) throw std::runtime_error("zora: curl_easy_init failed");
        HttpResponse resp;
        curl_slist* list = nullptr;
        for (const auto& [k, v] : headers) list = curl_slist_append(list, (k + ": " + v).c_str());
        std::unique_ptr<curl_slist, decltype(&curl_slist_free_all)> hdrs(list, curl_slist_free_all);
        curl_easy_setopt(curl.get(), CURLOPT_URL, url.c_str());
        curl_easy_setopt(curl.get(), CURLOPT_CUSTOMREQUEST, method.c_str());
        curl_easy_setopt(curl.get(), CURLOPT_HTTPHEADER, hdrs.get());
        curl_easy_setopt(curl.get(), CURLOPT_TIMEOUT_MS, static_cast<long>(timeout.count()));
        curl_easy_setopt(curl.get(), CURLOPT_NOSIGNAL, 1L);
        curl_easy_setopt(curl.get(), CURLOPT_ACCEPT_ENCODING, "");
        curl_easy_setopt(curl.get(), CURLOPT_WRITEFUNCTION, on_body);
        curl_easy_setopt(curl.get(), CURLOPT_WRITEDATA, &resp.body);
        curl_easy_setopt(curl.get(), CURLOPT_HEADERFUNCTION, on_header);
        curl_easy_setopt(curl.get(), CURLOPT_HEADERDATA, &resp.headers);
        if (!body.empty()) {
            curl_easy_setopt(curl.get(), CURLOPT_POSTFIELDS, body.c_str());
            curl_easy_setopt(curl.get(), CURLOPT_POSTFIELDSIZE, static_cast<long>(body.size()));
        }
        CURLcode rc = curl_easy_perform(curl.get());
        if (rc != CURLE_OK) throw std::runtime_error(std::string("zora: ") + method + " " + url + ": " + curl_easy_strerror(rc));
        long status = 0;
        curl_easy_getinfo(curl.get(), CURLINFO_RESPONSE_CODE, &status);
        resp.status = static_cast<int>(status);
        return resp;
    }
};

}  // namespace

std::shared_ptr<Transport> make_curl_transport() { return std::make_shared<CurlTransport>(); }

}  // namespace zora
