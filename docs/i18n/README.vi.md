# MCPGateway — Chia sẻ máy chủ MCP cục bộ giữa các phiên tác nhân lập trình

[English](../../README.md)

> Đây là phần tổng quan đã được bản địa hóa. Bản [README](../../README.md) tiếng Anh và hướng dẫn ứng dụng khách tiếng Anh được liên kết bên dưới là nguồn chính thức cho cài đặt đầy đủ, nâng cấp và chi tiết kỹ thuật.

Không cần khởi động một bản sao máy chủ MCP cho mỗi phiên Copilot CLI. Dùng chung các backend cục bộ đã cấu hình, khám phá công cụ khi cần và phối hợp các quy trình chỉ cho phép một phiên truy cập tại một thời điểm. Đây không phải nền tảng quản trị API doanh nghiệp.

**Điều kiện cần:** Node.js 24 trở lên, npm, Git, Copilot CLI hỗ trợ plugin và dịch vụ MCP đã cấu hình, xác thực. Lần cài đặt đầu hiện phải qua Copilot CLI; Windows là nền tảng được kiểm thử chính, Agency là tùy chọn. Khả năng tương thích và mức kiểm chứng khác nhau theo ứng dụng khách.

Gateway luôn cung cấp 6 công cụ cho tác nhân: 4 công cụ để tìm và gọi chức năng, cùng 2 công cụ cho tích hợp chỉ cho phép một phiên truy cập tại một thời điểm. Thêm kết nối không làm tăng giao diện ban đầu; lược đồ đầy đủ chỉ được tải cho công cụ đã chọn. Các kết nối bạn đã cấu hình và xác thực được dùng lại, không cài đặt dịch vụ hoặc cung cấp thông tin xác thực.

Ví dụ, Copilot có **10** kết nối; chủ động di chuyển **2** kết nối mới từ cấu hình Claude được hỗ trợ sẽ cho phép hai tác nhân cùng dùng **12** kết nối.

- Chỉ cài plugin không tự hợp nhất cấu hình. Mục trùng tên chỉ được loại bỏ bản sao khi định nghĩa bí danh giống hệt; cùng trỏ đến một dịch vụ là chưa đủ. Xung đột sẽ dừng quy trình để xem xét.
- Di chuyển hiển thị bản xem trước, tạo bản sao lưu và từ chối thiết lập native không được hỗ trợ.
- Điều này không có nghĩa mọi ứng dụng khách native đều được kiểm thử đầu cuối. [Hướng dẫn di chuyển (tiếng Anh)](../CLIENTS.md#cross-client-migration).

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

## Thiết lập và gọi công cụ lần đầu

```powershell
copilot plugin marketplace add yeelam-gordon/MCPGateway
copilot plugin install shared-mcp-gateway@mcp-gateway
```

1. Sau khi cài đặt, mở Copilot CLI và gọi `/mcp-gateway-setup`. Xem trước rồi chỉ phê duyệt thay đổi mong muốn. Đóng và mở lại Copilot, chạy đúng `readinessCommand` được trả về. Giữ bản sao lưu riêng tư và lệnh hoàn tác.
2. Gọi `list_servers` với `{}`: sẽ thấy bí danh, trạng thái và cờ truy cập dành riêng cho một phiên của các dịch vụ đã cấu hình. Chọn backend được phép dùng, tìm thuật ngữ liên quan bằng `search_tools`, rồi lấy lược đồ đầu vào qua `get_tool_schema`. Chuẩn bị đối số đúng lược đồ và dùng `call_tool` để đọc dữ liệu đã được phê duyệt. Kết quả mong đợi là bản ghi thực hoặc kết quả rỗng có giải thích; phải kiểm tra lỗi, không coi việc nhận phản hồi là bằng chứng thành công.
3. Nếu `requiresExclusiveAccess: true`, gọi `claim_server` trước khi tìm và `release_server` sau khi mọi lệnh gọi kết thúc. Backend không yêu cầu truy cập dành riêng cho một phiên không cần giữ quyền. Khi hết thời gian chờ mà chưa biết kết quả, không thử lại; kiểm tra công việc đang chạy rồi phối hợp khởi động lại. Khi chưa biết kết quả, backend chỉ cho phép một phiên truy cập vẫn bị chặn cho đến khi gateway khởi động lại; nhả quyền hoặc ngắt kết nối ứng dụng khách không thể gỡ chặn an toàn. Ngắt kết nối không hủy thao tác.

[Ví dụ đầy đủ bằng tiếng Anh](../../README.md#first-use) · [Tương thích](../CLIENTS.md#compatibility-summary)

## Giới hạn, quyền riêng tư và khôi phục

Tìm thấy kho này qua Claude Code, Codex, Gemini CLI, Kimi hoặc Qwen CLI không bảo đảm tích hợp native. Chưa có hướng dẫn cài Gemini CLI tại đây; Antigravity là ứng dụng khác. Kimi chỉ được kiểm thử ở lớp adapter. Cấu hình và bản sao lưu có thể chứa thông tin xác thực; không công khai hoặc đưa vào quản lý phiên bản. Backend có thể liên hệ dịch vụ từ xa; chia sẻ không có nghĩa hoạt động offline hay tiết kiệm RAM/token cố định.

Nếu danh sách trống, kiểm tra cấu hình đã chọn và bản xem trước di chuyển. Nếu không có kết quả tìm, dùng từ trong mô tả công cụ của backend. Khi xác thực hoặc kiểm tra trạng thái sẵn sàng thất bại, hãy làm theo tài liệu vận hành; không mở tiến trình khác để bỏ qua gateway. Khôi phục cấu hình khách không dừng runtime thường trú; khi ngừng dùng, theo hướng dẫn bàn giao cho người vận hành và kiểm tra hoàn tất.

[Quyền riêng tư](../REFERENCE.md#state-and-privacy) · [Khôi phục và hoàn tác](../REFERENCE.md#setup-recovery) · [Ngừng dùng và bàn giao](../REFERENCE.md#planned-exit)

Thiết lập hiển thị bản xem trước trước khi thay đổi. Sau khi được phê duyệt, thiết lập tạo bản sao lưu riêng tư rồi trả về kiểm tra sẵn sàng và lệnh hoàn tác chính xác. Cấu hình và bản sao lưu có thể chứa thông tin xác thực; đừng công khai hoặc commit vào hệ thống quản lý phiên bản.

**Tài liệu vận hành (tiếng Anh):** [Xem tài liệu vận hành](../REFERENCE.md)

**Giấy phép:** [MIT](../../LICENSE)
