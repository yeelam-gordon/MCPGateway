# Shared MCP Gateway

[English](../../README.md)

> Đây là phần tổng quan đã được bản địa hóa. Bản [README](../../README.md) tiếng Anh và hướng dẫn ứng dụng khách tiếng Anh được liên kết bên dưới là nguồn chính thức cho cài đặt đầy đủ, nâng cấp và chi tiết kỹ thuật.

## Tiết kiệm RAM. Giữ ngữ cảnh cho công việc. Công cụ khi cần.

**Nhiều tác nhân hơn phải mang lại nhiều công việc hoàn thành hơn, không phải nhiều bản sao của cùng một cấu hình MCP.**

### 5 tác nhân. 12 kết nối MCP. Một cấu hình dùng chung.

*Ví dụ minh họa: **12** kết nối này cung cấp **1,000** công cụ và mỗi cấu hình độc lập sử dụng **1.5 GB** RAM của tiến trình cục bộ.*

| Lợi ích | Cấu hình riêng cho từng tác nhân | Với MCPGateway |
|---|---|---|
| **Tiết kiệm RAM** | **7.5 GB** cho năm cấu hình MCP độc lập. | **1.5 GB dùng chung**, cộng thêm chi phí của gateway và trình kết nối. **Tránh 6 GB bộ nhớ trùng lặp.** |
| **Giữ ngữ cảnh. Công cụ khi cần.** | Mỗi tác nhân tải trước **1,000 định nghĩa công cụ**; số lượng có thể tăng khi thêm kết nối MCP. | Ban đầu chỉ có **6 công cụ gateway—ít hơn 99.4% định nghĩa**. Cả **1,000** công cụ vẫn sẵn dùng; mỗi tác nhân chỉ khám phá và tải những gì cần thiết. Thêm kết nối mà không phải tải toàn bộ danh mục vào mọi tác nhân. |

**Giữ các tác nhân và kết nối MCP của bạn. Đừng bắt mỗi phiên mang theo một bản sao riêng.**

*Số liệu RAM chỉ mang tính minh họa, không phải mức tiết kiệm đã đo; bộ nhớ của tác nhân là phần bổ sung. Số lượng định nghĩa không đồng nghĩa với tiết kiệm token, và ứng dụng khách đã trì hoãn tải có thể nhận được lợi ích ngữ cảnh nhỏ hơn. Việc dùng chung không mở rộng cửa sổ ngữ cảnh hoặc giữ tổng mức dùng RAM không đổi.*

## Cách hoạt động

Gateway luôn cung cấp 6 công cụ cho tác nhân: 4 công cụ để tìm và gọi chức năng, cùng 2 công cụ cho tích hợp cần quy trình độc quyền. Thêm kết nối không làm tăng giao diện ban đầu; lược đồ đầy đủ chỉ được tải cho công cụ đã chọn. Các kết nối bạn đã cấu hình và xác thực được dùng lại, không cài đặt dịch vụ hoặc cung cấp thông tin xác thực.

**Điều kiện cần:** Node.js 24 trở lên, npm, Git và Copilot CLI hỗ trợ plugin cho quy trình khởi tạo hiện tại. Agency là tùy chọn.

## Cài đặt và nâng cấp theo ứng dụng khách

Runtime dùng chung hiện được tạo qua Copilot CLI; các ứng dụng khách khác kết nối với cùng một trình kết nối ổn định. Các liên kết sau mở hướng dẫn ứng dụng khách tiếng Anh, nguồn chính thức cho cài đặt và nâng cấp.

| Ứng dụng khách | Cài đặt | Nâng cấp |
|---|---|---|
| GitHub Copilot CLI | [Cài đặt](../CLIENTS.md#copilot-cli-install) | [Nâng cấp](../CLIENTS.md#copilot-cli-upgrade) |
| VS Code (trình soạn thảo) | [Cài đặt](../CLIENTS.md#vs-code-install) | [Nâng cấp](../CLIENTS.md#vs-code-upgrade) |
| Claude Code | [Cài đặt](../CLIENTS.md#claude-code-install) | [Nâng cấp](../CLIENTS.md#claude-code-upgrade) |
| Codex CLI | [Cài đặt](../CLIENTS.md#codex-install) | [Nâng cấp](../CLIENTS.md#codex-upgrade) |
| OpenCode | [Cài đặt](../CLIENTS.md#opencode-install) | [Nâng cấp](../CLIENTS.md#opencode-upgrade) |
| Qwen Code | [Cài đặt](../CLIENTS.md#qwen-code-install) | [Nâng cấp](../CLIENTS.md#qwen-code-upgrade) |
| Kimi CLI | [Cài đặt](../CLIENTS.md#kimi-cli-install) | [Nâng cấp](../CLIENTS.md#kimi-cli-upgrade) |
| Antigravity CLI | [Cài đặt](../CLIENTS.md#antigravity-cli-install) | [Nâng cấp](../CLIENTS.md#antigravity-cli-upgrade) |

Thiết lập hiển thị bản xem trước trước khi thay đổi. Sau khi được phê duyệt, thiết lập tạo bản sao lưu riêng tư rồi trả về kiểm tra sẵn sàng và lệnh hoàn tác chính xác. Cấu hình và bản sao lưu có thể chứa thông tin xác thực; đừng công khai hoặc commit vào hệ thống quản lý phiên bản.

**Tài liệu vận hành (tiếng Anh):** [Xem tài liệu vận hành](../REFERENCE.md)

**Giấy phép:** [MIT](../../LICENSE)
