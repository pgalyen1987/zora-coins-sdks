// JSON helpers shared by the generated models. Part of zora-coins-cpp.
#pragma once

#include <memory>
#include <optional>
#include <string>
#include <vector>

#include <nlohmann/json.hpp>

namespace zora::detail {

// Reads an optional field: absent or null leaves it empty.
template <typename T>
void get_optional(const nlohmann::json& j, const char* key, std::optional<T>& out) {
    auto it = j.find(key);
    if (it != j.end() && !it->is_null()) out = it->template get<T>();
}

// Reads a self-referencing field held by shared_ptr: absent or null leaves it null.
template <typename T>
void get_optional(const nlohmann::json& j, const char* key, std::shared_ptr<T>& out) {
    auto it = j.find(key);
    if (it != j.end() && !it->is_null()) out = std::make_shared<T>(it->template get<T>());
}

template <typename T>
void get_required(const nlohmann::json& j, const char* key, T& out) {
    auto it = j.find(key);
    if (it != j.end() && !it->is_null()) out = it->template get<T>();
}

// A boolean the API may send as a string: /quote returns "success": "true".
inline void get_flex_bool(const nlohmann::json& j, const char* key, std::optional<bool>& out) {
    auto it = j.find(key);
    if (it == j.end() || it->is_null()) return;
    if (it->is_boolean()) out = it->get<bool>();
    else if (it->is_string()) out = it->get<std::string>() == "true";
}

template <typename T>
void put_optional(nlohmann::json& j, const char* key, const std::optional<T>& v) {
    if (v) j[key] = *v;
}

template <typename T>
void put_optional(nlohmann::json& j, const char* key, const std::shared_ptr<T>& v) {
    if (v) j[key] = *v;
}

template <typename T>
void put_required(nlohmann::json& j, const char* key, const T& v) {
    j[key] = v;
}

}  // namespace zora::detail

namespace zora::detail {

// A list field that closes a type cycle is a plain vector (empty = absent), because
// std::optional<std::vector<T>> needs T complete.
template <typename T>
void get_optional(const nlohmann::json& j, const char* key, std::vector<T>& out) {
    auto it = j.find(key);
    if (it != j.end() && !it->is_null()) out = it->template get<std::vector<T>>();
}

template <typename T>
void put_optional(nlohmann::json& j, const char* key, const std::vector<T>& v) {
    if (!v.empty()) j[key] = v;
}

}  // namespace zora::detail
