# MCPGateway — Chia sẻ máy chủ MCP cục bộ giữa các phiên tác nhân lập trình

Không cần khởi động một bản sao máy chủ MCP cho mỗi phiên Copilot CLI. Dùng chung các backend cục bộ đã cấu hình, khám phá công cụ khi cần và phối hợp các quy trình chỉ cho phép một phiên truy cập tại một thời điểm. Đây không phải nền tảng quản trị API doanh nghiệp.

- Dùng chung RAM và công việc khởi động của backend nặng, thay vì mỗi phiên một bản.
- Tìm khả năng và schema khi cần qua 6 công cụ ban đầu.
- Thêm backend, giữ kết nối MCP của tác nhân. [SDK/stdio](../BENCHMARK.md#configuration-only-connection-continuity)

Thêm backend mà không khởi động lại kết nối MCP hiện tại của tác nhân: đồng bộ các mục mới, hoàn tất công việc đang chạy rồi chỉ khởi động lại gateway thuộc quyền quản lý; bộ kết nối hiện tại sẽ kết nối lại. [SDK/stdio](../BENCHMARK.md#configuration-only-connection-continuity)

Phù hợp nhiều phiên dùng cùng backend và danh mục; một phiên hoặc backend nhẹ có thể không bù được chi phí phụ.

[Bắt đầu: cài đặt và lần đọc được phép đầu tiên](#first-use) · [MCP / Copilot CLI](../CLIENTS.md#shared-core-install) · [6 công cụ / 2 ứng dụng khách](../../test/catalog-scale.test.js)

[Tránh RAM của backend chạy trùng lặp](#resource-examples): 5 × 1.5 GB = 7.5 GB → 1.5 GB + chi phí phụ của gateway và bộ kết nối.

<img src="../../assets/mcp-gateway-benefits.png" alt="Dùng chung RAM và công việc khởi động của backend nặng, thay vì mỗi phiên một bản." width="780">

Hình khái niệm có nhãn tiếng Anh, không phải ảnh chạy thực hay benchmark. Giả định 1.5 GB mỗi bộ: 6 GB trùng lặp tránh được trước chi phí phụ. Fixture nhẹ đã đo dùng nhiều RAM tổng hơn.

<a id="first-use"></a>
## Thiết lập và gọi công cụ lần đầu

**Điều kiện cần:** Node.js 24 trở lên, npm, Git, Copilot CLI hỗ trợ plugin và dịch vụ MCP đã cấu hình, xác thực. Lần cài đặt đầu hiện phải qua Copilot CLI; Windows là nền tảng được kiểm thử chính, Agency là tùy chọn. Khả năng tương thích và mức kiểm chứng khác nhau theo ứng dụng khách.

Cấu hình và bản sao lưu có thể chứa thông tin xác thực: giữ riêng tư và chỉ chấp thuận thay đổi dự định.

```powershell
copilot plugin marketplace add yeelam-gordon/MCPGateway
copilot plugin install shared-mcp-gateway@mcp-gateway
```

1. Sau khi cài đặt, mở Copilot CLI và gọi `/mcp-gateway-setup`. Xem trước rồi chỉ phê duyệt thay đổi mong muốn. Đóng và mở lại Copilot, chạy đúng `readinessCommand` được trả về. Giữ bản sao lưu riêng tư và lệnh hoàn tác.

Khám phá và lấy schema không cần giữ quyền; nếu `requiresExclusiveAccess: true`, gọi `claim_server` trước `call_tool`.

2. Gọi `list_servers` với `{}`: sẽ thấy bí danh, trạng thái và cờ truy cập dành riêng cho một phiên của các dịch vụ đã cấu hình. Chọn backend được phép dùng, tìm thuật ngữ liên quan bằng `search_tools`, rồi lấy lược đồ đầu vào qua `get_tool_schema`. Chọn tác vụ chỉ đọc, vô hại và đã được cho phép. Chuẩn bị đối số đúng lược đồ, chỉ dùng các giá trị thử nghiệm được phép và không chứa thông tin nhạy cảm, rồi dùng `call_tool` để thực hiện tác vụ đó. Kết quả mong đợi là bản ghi thực hoặc kết quả rỗng có giải thích; phải kiểm tra lỗi, không coi việc nhận phản hồi là bằng chứng thành công.
3. Nếu `requiresExclusiveAccess: true`, gọi `claim_server` trước khi gọi và `release_server` sau khi mọi lệnh gọi kết thúc. Backend không yêu cầu truy cập dành riêng cho một phiên không cần giữ quyền. Khi hết thời gian chờ mà chưa biết kết quả, không thử lại; kiểm tra công việc đang chạy rồi phối hợp khởi động lại. Khi chưa biết kết quả, backend chỉ cho phép một phiên truy cập vẫn bị chặn cho đến khi gateway khởi động lại; nhả quyền hoặc ngắt kết nối ứng dụng khách không thể gỡ chặn an toàn. Ngắt kết nối không hủy thao tác.
4. Trong phiên thứ hai dùng cùng bộ kết nối và danh mục, lặp lại `list_servers` / `search_tools` cho cùng bí danh. Backend đã khởi tạo nên có trạng thái `ready`, tìm kiếm trả khả năng từ cùng danh mục. Bí danh trùng không chứng minh cùng tiến trình hay tiết kiệm RAM; xem kiểm thử tái sử dụng công khai. [Phương pháp tái sử dụng tiến trình](../BENCHMARK.md#method) · [Kiểm thử cache danh mục](../../test/catalog-scale.test.js)

[Ví dụ đầy đủ bằng tiếng Anh](../../README.md#first-use) · [Tương thích](../CLIENTS.md#compatibility-summary)

## Giới hạn, quyền riêng tư và khôi phục

Tìm thấy kho này qua Claude Code, Codex, Gemini CLI, Kimi hoặc Qwen CLI không bảo đảm tích hợp native. Chưa có hướng dẫn cài Gemini CLI tại đây; Antigravity là ứng dụng khác. Kimi chỉ được kiểm thử ở lớp adapter. Cấu hình và bản sao lưu có thể chứa thông tin xác thực; không công khai hoặc đưa vào quản lý phiên bản. Backend có thể liên hệ dịch vụ từ xa; chia sẻ không có nghĩa hoạt động offline hay tiết kiệm RAM/token cố định.

Nếu danh sách trống, kiểm tra cấu hình đã chọn và bản xem trước di chuyển. Nếu không có kết quả tìm, dùng từ trong mô tả công cụ của backend. Khi xác thực hoặc kiểm tra trạng thái sẵn sàng thất bại, hãy làm theo tài liệu vận hành; không mở tiến trình khác để bỏ qua gateway. Khôi phục cấu hình khách không dừng runtime thường trú; khi ngừng dùng, theo hướng dẫn bàn giao cho người vận hành và kiểm tra hoàn tất.

[Quyền riêng tư](../REFERENCE.md#state-and-privacy) · [Khôi phục và hoàn tác](../REFERENCE.md#setup-recovery) · [Ngừng dùng và bàn giao](../REFERENCE.md#planned-exit)

Thiết lập hiển thị bản xem trước trước khi thay đổi. Sau khi được phê duyệt, thiết lập tạo bản sao lưu riêng tư rồi trả về kiểm tra sẵn sàng và lệnh hoàn tác chính xác. Cấu hình và bản sao lưu có thể chứa thông tin xác thực; đừng công khai hoặc commit vào hệ thống quản lý phiên bản.

**Tài liệu vận hành (tiếng Anh):** [Xem tài liệu vận hành](../REFERENCE.md)

**Giấy phép:** [MIT](../../LICENSE)


<a id="resource-examples"></a>

**Tránh RAM của backend chạy trùng lặp**

Giả định minh họa, không phải benchmark: 5 phiên đều cần cùng 12 kết nối; một bộ backend đầy đủ dùng 1.5 GB. Các phiên tương thích chia sẻ tiến trình thực qua cùng bộ kết nối và danh mục.

| Cách triển khai | RAM backend |
|---|---|
| Các bản chạy riêng | 5 × 1.5 GB = 7.5 GB |
| Một bộ dùng chung | 1.5 GB + chi phí bộ nhớ của gateway và bộ kết nối |

RAM backend trùng lặp tránh được trước chi phí phụ: 7.5 GB - 1.5 GB = 6 GB. Tổng mức tiết kiệm chưa biết cho đến khi đo. 1.5 GB không cố định giữa tải công việc hay ứng dụng khách; đây không phải RAM của năm mô hình.

**Tái sử dụng cả công việc khởi động.** Nếu cả 5 phiên dùng đủ 12 dịch vụ stdio, các bản riêng cần tối đa `5 × 12 = 60` lần khởi động so với `12` khi chia sẻ: tránh `60 - 12 = 48` lần trùng lặp, giảm `48 / 60 × 100 = 80%` số lần. Kết nối khi cần chỉ kết nối `k` backend được dùng; backend không dùng không khởi động. Đây là số thao tác, không phải nhanh hơn 80%. Độ trễ chưa được đo; chạy đồng thời, xác thực và nền tảng ảnh hưởng thời gian.

1000 công cụ → 6 định nghĩa ban đầu: (1000 - 6) / 1000 × 100 = 99.4% ít định nghĩa hơn, không phải token. Schema được yêu cầu sau vẫn có chi phí; ứng dụng khách đã tải trì hoãn có thể được lợi ít hơn. Kiểm thử danh mục tổng hợp xác minh sáu công cụ và cache khám phá dùng chung giữa hai ứng dụng khách, không đo hiệu năng RSS. [catalog-scale.test.js](../../test/catalog-scale.test.js)

**Fixture nhẹ đã đo: có tái sử dụng nhưng RAM tổng tăng và khởi động nguội không nhanh hơn.** Trung vị 3 lần, Windows x64 / Node 24.13.1: schema + echo chia sẻ 426.2 ms với backend nguội, 21.1 ms ở ứng dụng khách thứ hai, 19.0 ms ở thứ năm. Tổng lần đầu: trực tiếp 503.5 ms, chia sẻ khi gateway sẵn sàng 894.3 ms; chia sẻ hoàn toàn nguội 1886.7 ms. Tiến trình backend 5 → 1 nhưng tổng tiến trình 5 → 7, tổng working set 357.0 MiB → 564.0 MiB: RAM tổng kém hơn. Một echo không đại diện dịch vụ thực nặng; 1.5 GB phía trên là giả định riêng, không phải số đo. [BENCHMARK.md](../BENCHMARK.md)

<a id="mechanism"></a>

Kiểm thử SDK/stdio giữ nguyên bộ kết nối và kết nối MCP để tìm bí danh mới và gọi echo sau khởi động lại; chưa kiểm thử giao diện hội thoại của từng sản phẩm. Không tự động hot reload; xung đột cần xem xét. Đăng ký ban đầu hoặc nâng cấp runtime có thể cần khởi động lại ứng dụng khách. Không phát lại lời gọi gián đoạn; giữ lại quyền độc quyền bằng yêu cầu mới sau khởi động lại.

```text
Tác nhân A ─┐                           ┌─ Tích hợp A: nhiều công cụ
Tác nhân B ─┼─ bộ kết nối ─ MCPGateway ─┼─ Tích hợp B: nhiều công cụ
Tác nhân C ─┘                           └─ Tích hợp C: nhiều công cụ
```

Nhiều tác nhân truy cập MCPGateway qua cùng một bộ kết nối; các backend đã cấu hình được chọn sẽ được kết nối khi cần. Sơ đồ minh họa cơ chế chia sẻ, không phải kết quả benchmark hay kiểm chứng khi chạy, và không có nghĩa là khởi động mọi backend.

> Đây là phần tổng quan đã được bản địa hóa. Bản [README](../../README.md) tiếng Anh và hướng dẫn ứng dụng khách tiếng Anh được liên kết bên dưới là nguồn chính thức cho cài đặt đầy đủ, nâng cấp và chi tiết kỹ thuật.

[English](../../README.md)

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
