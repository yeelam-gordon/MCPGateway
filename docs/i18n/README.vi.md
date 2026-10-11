# MCPGateway — Chia sẻ backend MCP cục bộ giữa các phiên lập trình

<a id="languages"></a>
<details>
<summary>Languages (16)</summary>

[English](../../README.md) · [简体中文](README.zh-CN.md) · [繁體中文](README.zh-TW.md) · [日本語](README.ja.md) · [한국어](README.ko.md) · [Español](README.es.md) · [Français](README.fr.md) · [Deutsch](README.de.md) · [Português (Brasil)](README.pt-BR.md) · [Italiano](README.it.md) · [Русский](README.ru.md) · [العربية](README.ar.md) · [हिन्दी](README.hi.md) · [Bahasa Indonesia](README.id.md) · [Türkçe](README.tr.md) · [Tiếng Việt](README.vi.md)

</details>

Nhiều phiên dùng một bộ backend: tránh bộ nhớ trùng lặp và công việc khởi động lặp lại. Tuyến SDK/stdio đã kiểm thử giữ kết nối MCP hiện có khi thêm cấu hình (kết nối hiện có từ agent của bạn tới gateway).

[Bắt đầu](#first-use) · [Tương thích (tiếng Anh)](../CLIENTS.md#compatibility-summary) · [Bằng chứng và giới hạn (tiếng Anh)](../BENCHMARK.md) · [Cập nhật Copilot](../CLIENTS.md#copilot-cli-upgrade)

<img src="../../assets/mcp-gateway-benefits.png" alt="Các bản sao backend thành một bộ dùng chung; công việc khởi động được dùng lại; trong thử nghiệm SDK/stdio, kết nối MCP hiện có được giữ khi khởi động lại gateway do mình quản lý sau khi công việc hoàn tất." width="780">

Hình minh họa khái niệm với nhãn tiếng Anh, không phải ảnh ứng dụng hay benchmark. [SVG](../../assets/mcp-gateway-benefits.svg)

- **Tránh bộ nhớ backend trùng lặp:** Với giả định chia sẻ 5 × 1.5 GB thành một bộ, tránh 6 GB trùng lặp **trước** chi phí gateway và bộ kết nối. Không phải mức tiết kiệm ròng đã đo.
- **Dùng lại công việc khởi động backend:** Nếu cả năm phiên dùng đủ mười hai dịch vụ stdio, số lần khởi động là 60 → 12. Không có nghĩa khởi động nhanh hơn 80%.
- **Giữ kết nối MCP hiện có:** Thử nghiệm SDK/stdio giữ kết nối sau khi chỉ thêm cấu hình và khởi động lại gateway do mình quản lý khi công việc kết thúc. Không chứng minh hot reload, tính liên tục của lời gọi đang chạy hay mọi giao diện hội thoại native. Đăng ký lần đầu và nâng cấp runtime có thể cần khởi động lại ứng dụng khách. [SDK/stdio](../BENCHMARK.md#configuration-only-connection-continuity)

<a id="resource-examples"></a>
**Khi nên dùng hoặc bỏ qua:** Dành cho nhiều phiên cùng bộ kết nối và danh mục. MCP trực tiếp có thể đơn giản hơn cho một phiên hoặc backend nhẹ. Kiểm thử nhẹ tăng tổng working set tiến trình từ 357.0 → 564.0 MiB; yêu cầu dùng chung đầu tiên, từ khởi chạy gateway mới đến kết quả hữu ích đầu tiên, mất 1886.7 ms so với trực tiếp 503.5 ms. Lợi ích ròng phụ thuộc chi phí phụ. [BENCHMARK](../BENCHMARK.md#sharing-model-and-evidence)

<a id="first-use"></a>
## Kết quả hữu ích đầu tiên: đọc dữ liệu được phép qua gateway

Cần Node.js 24+, npm, Git, Copilot CLI hỗ trợ plugin và tích hợp MCP đã cấu hình, xác thực theo yêu cầu. Cài lần đầu qua Copilot CLI; Windows là nền tảng kiểm thử chính. Mức kiểm chứng khác nhau theo ứng dụng khách. [Copilot `/help` · `/plugin`](../CLIENTS.md#copilot-plugin-eligibility).

**Trước khi cài:** Cấu hình, danh mục riêng tư và bản sao lưu có thể chứa thông tin xác thực: đừng công khai. Backend có thể liên hệ dịch vụ từ xa. Runtime thường trú được cài; khôi phục cấu hình hay gỡ plugin không dừng gateway. [REFERENCE](../REFERENCE.md#planned-exit) Trạng thái riêng cục bộ và token gateway đã lưu chỉ cho chủ sở hữu truy cập, không được mã hóa thêm.

```powershell
copilot plugin marketplace add yeelam-gordon/MCPGateway
copilot plugin install shared-mcp-gateway@mcp-gateway
```

1. Mở Copilot CLI và gọi `/mcp-gateway-setup`. Xem bản xem trước, chỉ duyệt thay đổi mong muốn. Giữ bản sao lưu riêng tư và lệnh hoàn tác. Chỉ cài plugin không hợp nhất cấu hình.
2. Đóng và mở lại Copilot; chạy đúng `readinessCommand` được trả về theo hướng dẫn đối tượng lệnh. Lệnh kiểm tra không khởi động gateway chưa chạy. [readinessCommand](../REFERENCE.md#readiness-command-object) Chỉ lưu đối tượng JSON trả về; `.command` là tệp thực thi đã được phê duyệt và `.args` là các đối số chính xác theo đúng thứ tự.
3. Chọn tác vụ chỉ đọc vô hại, được phép trong tích hợp hiện có. Chỉ thay tác vụ trong ngoặc; lấy bí danh, công cụ và đối số từ khám phá và lược đồ, không đoán.

> Dùng gateway cho [tác vụ chỉ đọc được phép của tôi]. Chạy `list_servers`, tìm kiếm có mục tiêu bằng `search_tools` và `get_tool_schema`; chuẩn bị đối số đúng lược đồ với giá trị thử nghiệm được phép, không nhạy cảm. Xin phê duyệt thông thường. Nếu `requiresExclusiveAccess: true`, dùng `claim_server` một lần trước `call_tool` và `release_server` sau khi mọi lời gọi hoàn tất; backend không độc quyền không cần giữ quyền. Hiển thị bản ghi thực hoặc kết quả rỗng có giải thích và kiểm tra lỗi, không chỉ phản hồi của gateway. Khi chưa biết kết quả, không thử lại: giữ trạng thái chặn và bàn giao riêng tư cho người quản lý cài đặt.

4. Trong phiên thứ hai cùng bộ kết nối và danh mục, tìm cùng bí danh: mong đợi `ready` và cùng khả năng. Đây là kiểm tra khám phá dùng chung, không chứng minh cùng tiến trình hay tiết kiệm RAM. [MCP](../REFERENCE.md#first-shared-workflow) [Ví dụ echo công khai và kết quả](../REFERENCE.md#public-echo-illustration).

**Nếu thất bại:** Danh mục trống: kiểm tra cấu hình và bản xem trước; tìm từ trong mô tả backend. Theo tài liệu khi xác thực hoặc sẵn sàng thất bại, không chạy tiến trình để vượt gateway. Nhả quyền hoặc ngắt kết nối không hủy hay gỡ chặn an toàn kết quả độc quyền chưa biết. Đối chiếu kết quả, phối hợp khởi động lại gateway do mình quản lý rồi yêu cầu lại quyền. [Authentication](../REFERENCE.md#native-http-oauth) · [Recovery](../REFERENCE.md#setup-recovery) · [Unknown outcome](../REFERENCE.md#unknown-exclusive-result)

**Ngừng dùng:** Hoàn tất công việc và lời gọi, khôi phục hoặc loại bỏ bộ kết nối của ứng dụng khách liên quan, rồi theo bàn giao người vận hành để xác minh gateway do mình quản lý đã dừng. Hoàn tác cấu hình không dừng tiến trình. Giữ trạng thái riêng tư, thông tin xác thực, lịch sử và tiến trình không liên quan. [Exit](../REFERENCE.md#planned-exit)

<a id="clients"></a>
Đây là bản tổng quan tiếng Việt. Phương pháp, nguồn số liệu và vận hành chi tiết ở tài liệu tiếng Anh. Hỗ trợ ứng dụng khách native không chứng nhận người dùng thực hiểu bản dịch này. [CLIENTS](../CLIENTS.md) · [REFERENCE](../REFERENCE.md) · [BENCHMARK](../BENCHMARK.md)

MIT — [LICENSE](../../LICENSE).
