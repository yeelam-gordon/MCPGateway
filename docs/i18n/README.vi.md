# Bắt đầu nhanh với Shared MCP Gateway

[English](../../README.md)

> Đây là hướng dẫn bắt đầu nhanh đã được bản địa hóa. Bản [README](../../README.md) tiếng Anh là nguồn chính thức cho cách dùng nâng cao và thông tin kỹ thuật mới nhất.

## Một gateway cho các backend MCP hiện có

Shared MCP Gateway giúp Copilot ban đầu chỉ tải một giao diện cố định gồm **6 công cụ gateway**, sau đó tìm và gọi theo nhu cầu các công cụ từ backend mà bạn đã cấu hình. Ngay cả khi danh mục có khoảng **1.000 công cụ**, ứng dụng khách cũng không cần nhận toàn bộ định nghĩa ngay từ đầu.

Danh mục và kết nối backend được dùng lại giữa nhiều phiên Copilot CLI, nhờ đó giảm việc khởi động trùng lặp các máy chủ cục bộ. Gateway không cài đặt máy chủ MCP và không cung cấp thông tin xác thực; hãy tiếp tục dùng cách hiện tại của bạn để cấu hình máy chủ và xác thực.

6 công cụ gồm 4 công cụ khám phá/thực thi và 2 công cụ thuê máy chủ dùng chung. Cơ chế thuê áp dụng cho mọi backend cần trạng thái quy trình độc quyền, không chỉ dành cho tự động hóa trình duyệt.

## Điều kiện cần

- Node.js 24 trở lên, npm và Git
- Copilot CLI có hỗ trợ plugin
- Cấu hình MCP hiện có của Copilot và thông tin xác thực mà backend yêu cầu
- Agency là tùy chọn và không cần thiết khi sử dụng Copilot CLI thông thường

## Cài đặt

Chạy các lệnh này trong **terminal**, không chạy trong cuộc trò chuyện Copilot:

```text
copilot plugin marketplace add yeelam-gordon/MCPGateway
copilot plugin install shared-mcp-gateway@mcp-gateway
```

Sau đó khởi động Copilot và chạy bên trong Copilot:

```text
/mcp-gateway-setup
```

Chỉ cài plugin sẽ không di chuyển cấu hình MCP. Quy trình thiết lập hiển thị bản xem trước trước; sau khi được phê duyệt, quy trình sẽ sao lưu cấu hình hiện có, lưu định nghĩa backend trong thư mục riêng tư và chuyển cấu hình ứng dụng khách sang trình kết nối gateway dùng chung.

Hãy giữ lại đường dẫn sao lưu và lệnh khôi phục chính xác được hiển thị. Danh mục backend và bản sao lưu có thể chứa thông tin xác thực; đừng công khai hoặc commit chúng vào hệ thống quản lý phiên bản.

Khi hoàn tất, hãy đóng rồi mở lại Copilot. Gateway tự khởi động khi trình kết nối được dùng lần đầu; bạn không cần duy trì một terminal riêng.

## Cách hoạt động

1. `list_servers` liệt kê các bí danh đã cấu hình mà không khởi động mọi backend.
2. `search_tools` tìm phần tóm tắt công cụ phù hợp trong một backend cụ thể.
3. `get_tool_schema` chỉ lấy lược đồ đầu vào đầy đủ của công cụ đã chọn.
4. `call_tool` kiểm tra đối số và danh sách cho phép trước khi gọi công cụ.
5. `claim_server` và `release_server` bảo vệ toàn bộ quy trình của máy chủ cần quyền truy cập độc quyền, rồi giải phóng lượt thuê sau khi các lệnh gọi đang hoạt động kết thúc.

Ứng dụng khách MCP, gateway và máy chủ MCP có vai trò khác nhau, nhưng bạn không cần hiểu chi tiết giao thức khi sử dụng hằng ngày: cứ cấu hình backend như trước và để Copilot khám phá, gọi chúng thông qua gateway.

## Cập nhật và khôi phục

Sau khi cập nhật plugin, hãy chạy `/mcp-gateway-setup` để chủ động áp dụng runtime mới. Chờ các lệnh gọi đang hoạt động kết thúc, áp dụng bản cập nhật rồi mở lại Copilot; chỉ tải plugin xuống sẽ không thay thế gateway đang chạy.

Nếu thiết lập thất bại, hãy đóng Copilot rồi dùng đúng đường dẫn sao lưu và lệnh khôi phục đã hiển thị. Đừng xóa thư mục backend riêng tư để cố khôi phục.
Xem bản [README](../../README.md) tiếng Anh để biết thêm về đồng bộ cấu hình, tích hợp ứng dụng khách, cơ chế thuê và xử lý sự cố.

**Giấy phép:** [MIT](../../LICENSE)
