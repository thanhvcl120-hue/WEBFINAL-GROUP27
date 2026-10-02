import React, { useEffect, useRef, useState } from "react";
import { ArrowLeft, Check, DoorOpen, Printer, Search, Wallet } from "lucide-react";
import { callApi, clock, minutesSince, money, PAYMENT_METHODS, useLiveUpdates, useResource } from "./staff-api.js";
import { RequireStaff } from "./StaffLogin.jsx";
import { ErrorNotice, PageHeading, StaffDialog } from "./StaffUI.jsx";
import { billFingerprint, billLines } from "./staff-model.js";
import "./staff.css";

const LIVE_EVENTS = ["session-updated", "order-created", "order-updated"];

function TableGrid({ onOpen }) {
  const { data: tables, loading, error: loadError, load } = useResource("/tables", []);
  const [error, setError] = useState("");
  const [seating, setSeating] = useState(null);
  const [filter, setFilter] = useState("all");
  const [search, setSearch] = useState("");
  const [, tick] = useState(0);
  const lock = useRef(false);
  const connection = useLiveUpdates(LIVE_EVENTS, load);
  useEffect(() => { const timer = setInterval(() => tick(value => value + 1), 60000); return () => clearInterval(timer); }, []);
  const seat = async tableNumber => {
    if (lock.current) return;
    lock.current = true; setSeating(tableNumber); setError("");
    try { await callApi("/tables/" + tableNumber + "/open", { method: "POST" }); await load(); }
    catch (problem) { setError(problem.message); load(); }
    finally { lock.current = false; setSeating(null); }
  };
  const occupied = tables.filter(table => table.session);
  const total = occupied.reduce((sum, table) => sum + table.session.total, 0);
  const visible = tables.filter(table => String(table.tableNumber).includes(search.trim()) && (filter === "all" || (filter === "occupied") === !!table.session));
  return <>
    <PageHeading eyebrow="PHỤC VỤ & THANH TOÁN" title="Sơ đồ bàn" description="Mở bàn đón khách, kiểm tra món và thanh toán tại đây." connection={connection}/>
    <div className="staff-stats"><div><span>Bàn đang phục vụ</span><strong>{loading ? "—" : occupied.length + "/" + tables.length}</strong></div><div><span>Tổng tạm tính các bàn</span><strong>{loading ? "—" : money(total)}</strong></div></div>
    <div className="table-toolbar"><div className="staff-segments" role="group" aria-label="Lọc bàn">
      {[["all", "Tất cả"], ["occupied", "Đang phục vụ"], ["free", "Bàn trống"]].map(([id, label]) => <button key={id} className={filter === id ? "on" : ""} aria-pressed={filter === id} onClick={() => setFilter(id)}>{label}</button>)}
    </div><label className="staff-search"><Search size={18}/><input inputMode="numeric" value={search} onChange={event => setSearch(event.target.value)} placeholder="Tìm số bàn…" aria-label="Tìm số bàn"/></label></div>
    <ErrorNotice error={loadError} retry={load}/><ErrorNotice error={error}/>
    {loading ? <div className="staff-empty" role="status">Đang tải sơ đồ bàn…</div> : <div className="table-grid">
      {visible.map(table => {
        const state = table.session;
        return <article key={table.tableNumber} className={"table-cell " + (state ? (state.items.length ? "busy" : "seated") : "free")}>
          <div className="table-top"><h2>Bàn {table.tableNumber}</h2><span className="table-status">{state ? state.items.length ? "Đang phục vụ" : "Chưa gọi món" : "Trống"}</span></div>
          {state ? <><strong>{money(state.total)}</strong><small>{state.orders.length} lượt gọi · {minutesSince(state.openedAt)} phút</small>
            <p className="table-flag">{state.pendingCount > 0 ? state.pendingCount + " đơn chưa phục vụ xong" : state.items.length ? "Đã phục vụ đủ món" : "Đã sẵn sàng nhận món"}</p>
            <button className="table-action" onClick={() => onOpen(state.id)} aria-label={"Xem bàn " + table.tableNumber}>Xem chi tiết <span>→</span></button>
          </> : <><p className="table-free-copy">Sẵn sàng đón khách</p><button className="table-action open" onClick={() => seat(table.tableNumber)} disabled={seating !== null} aria-label={"Mở bàn " + table.tableNumber}><DoorOpen size={17}/>{seating === table.tableNumber ? "Đang mở…" : "Mở bàn"}</button></>}
        </article>;
      })}
    </div>}
    {!loading && !loadError && visible.length === 0 && <div className="staff-empty"><h2>Không có bàn phù hợp</h2><p>Thử số bàn hoặc bộ lọc khác.</p><button className="ghost" onClick={() => { setSearch(""); setFilter("all"); }}>Xóa bộ lọc</button></div>}
  </>;
}

function Bill({ sessionId, onBack }) {
  const { data: bill, setData: setBill, error: loadError, load } = useResource("/sessions/" + sessionId, null);
  const [error, setError] = useState("");
  const [method, setMethod] = useState("cash");
  const [busy, setBusy] = useState(false);
  const [paid, setPaid] = useState(null);
  const [confirmation, setConfirmation] = useState(null);
  const lock = useRef(false);
  const connection = useLiveUpdates(LIVE_EVENTS, () => { if (!paid) load(); });
  const perform = async () => {
    if (lock.current) return;
    lock.current = true; setBusy(true); setError("");
    try {
      // Recheck immediately before confirming; the backend still owns totals and final validation.
      const latest = await callApi("/sessions/" + sessionId);
      setBill(latest);
      if (billFingerprint(latest) !== confirmation.fingerprint) {
        setConfirmation(null);
        setError("Hóa đơn vừa thay đổi. Vui lòng kiểm tra lại và xác nhận lần nữa.");
        return;
      }
      if (confirmation.mode === "close") {
        await callApi("/sessions/" + sessionId + "/close", { method: "POST" });
        onBack();
      } else {
        const closed = await callApi("/sessions/" + sessionId + "/pay", { method: "POST", body: JSON.stringify({ method }) });
        setPaid(closed); setConfirmation(null);
      }
    } catch (problem) { setError(problem.message); }
    finally { lock.current = false; setBusy(false); }
  };
  const view = paid || bill;
  const back = <button className="staff-back" disabled={busy} onClick={onBack}><ArrowLeft size={17}/> Về sơ đồ bàn</button>;
  if (!view) return <>{back}{loadError ? <ErrorNotice error={loadError} retry={load}/> : <div className="staff-empty" role="status">Đang tải hóa đơn…</div>}</>;
  const closed = view.status === "closed";
  const lines = billLines(view);
  const methodLabel = PAYMENT_METHODS.find(option => option.id === (closed ? view.paymentMethod : method))?.label;
  const confirm = mode => { setError(""); setConfirmation({ mode, fingerprint: billFingerprint(view), total: view.total, pending: view.pendingCount }); };
  return <>
    {back}
    <PageHeading eyebrow="CHI TIẾT PHIÊN BÀN" title={"Hóa đơn bàn " + view.tableNumber} description={closed ? "Phiên bàn đã kết thúc." : "Đối chiếu món và tổng tiền với khách trước khi thu tiền."} connection={connection}/>
    <section className="bill-sheet" aria-label={"Hóa đơn bàn " + view.tableNumber}>
      <div className="bill-sheet-head"><div><span className="staff-eyebrow">BẾP NHÀ · {closed && view.paymentMethod ? "ĐÃ THANH TOÁN" : "TẠM TÍNH"}</span><h2>Bàn {view.tableNumber}</h2><small>Phiên #{view.id}</small></div>
        <div className="bill-meta"><span>{new Date(view.openedAt).toLocaleDateString("vi-VN")}</span><span>Mở bàn lúc {clock(view.openedAt)}</span><span>{view.orders.length} lượt gọi</span></div></div>
      {closed ? <p className="bill-done" role="status"><Check size={20}/><span>{view.paymentMethod ? "Đã thanh toán " + money(view.total) + " · " + methodLabel : "Bàn đã đóng."}{view.closedAt && <small>Hoàn tất lúc {clock(view.closedAt)}{view.closedBy ? " · " + view.closedBy : ""}</small>}</span></p>
        : view.pendingCount > 0 && <p className="bill-warn">Còn {view.pendingCount} đơn chưa phục vụ xong. Thanh toán sẽ đánh dấu các đơn này là đã phục vụ.</p>}
      {lines.length === 0 ? <div className="staff-empty"><h3>Chưa có món tính tiền</h3><p>Bàn chưa gọi món hoặc tất cả món đã hủy. Bạn có thể đóng bàn nếu mở nhầm.</p></div> :
        <ul className="bill-lines">{lines.map(line => <li key={line.key}><span className="bill-qty">{line.quantity}×</span><span className="bill-dish">{line.name}<small>{money(line.price)} / món</small></span><strong>{money(line.subtotal)}</strong></li>)}</ul>}
      <div className="bill-sum"><span>{closed ? "Tổng thanh toán" : "Tổng tạm tính"}</span><strong>{money(view.total)}</strong></div>
      <ErrorNotice error={loadError} retry={load}/>{!confirmation && <ErrorNotice error={error}/>}
      {!closed && lines.length > 0 && <fieldset className="pay-methods" disabled={busy}><legend>Hình thức thanh toán</legend>{PAYMENT_METHODS.map(option => <label key={option.id} className={method === option.id ? "on" : ""}><input type="radio" name="payment-method" value={option.id} checked={method === option.id} onChange={() => setMethod(option.id)}/>{option.label}</label>)}</fieldset>}
      <div className="bill-actions">
        {lines.length > 0 && <button className="ghost" disabled={busy} onClick={() => window.print()}><Printer size={18}/>{closed ? "In hóa đơn" : "In tạm tính"}</button>}
        {closed ? <button className="solid" onClick={onBack}>Về sơ đồ bàn</button> : lines.length === 0 ?
          <button className="ghost" disabled={busy || !!loadError} onClick={() => confirm("close")}>Đóng bàn mở nhầm</button> :
          <button className="solid" disabled={busy || !!loadError} onClick={() => confirm("pay")}><Wallet size={18}/> Thanh toán {money(view.total)}</button>}
      </div>
    </section>
    {confirmation && <StaffDialog title={confirmation.mode === "close" ? "Đóng bàn " + view.tableNumber + "?" : "Xác nhận đã nhận tiền"} onClose={() => setConfirmation(null)} busy={busy}>
      <p className="dialog-copy">{confirmation.mode === "close" ? "Phiên bàn sẽ kết thúc và bàn được trả về trạng thái trống." : <>Bàn {view.tableNumber} · {methodLabel}<strong className="confirm-total">{money(confirmation.total)}</strong>Chỉ xác nhận khi đã nhận đủ tiền của khách. Phiên bàn sẽ đóng sau thao tác này.</>}</p>
      {confirmation.mode === "pay" && confirmation.pending > 0 && <p className="bill-warn">{confirmation.pending} đơn chưa phục vụ xong sẽ được chuyển thành đã phục vụ.</p>}
      <ErrorNotice error={error}/>
      <div className="dish-actions"><button className="ghost" disabled={busy} onClick={() => setConfirmation(null)}>Kiểm tra lại</button><button className="solid" disabled={busy} onClick={perform}>{busy ? "Đang xử lý…" : confirmation.mode === "close" ? "Đóng bàn" : "Đã nhận đủ tiền"}</button></div>
    </StaffDialog>}
  </>;
}

function CashierBoard() {
  const [openBill, setOpenBill] = useState(null);
  return <main className="staff-main">{openBill ? <Bill key={openBill} sessionId={openBill} onBack={() => setOpenBill(null)}/> : <TableGrid onOpen={setOpenBill}/>}</main>;
}

export default function Cashier() {
  return <RequireStaff roles={["cashier", "manager"]}>{() => <CashierBoard/>}</RequireStaff>;
}
