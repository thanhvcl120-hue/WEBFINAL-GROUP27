import React, { useRef, useState } from "react";
import { Link } from "react-router-dom";
import { Delete, LogIn, UtensilsCrossed } from "lucide-react";
import { callApi, ROLE_LABELS, useStaff } from "./staff-api.js";
import { ErrorNotice, StaffShell } from "./StaffUI.jsx";
import "./staff.css";

const KEYS = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "", "0", "del"];

export function StaffLogin({ onSignedIn }) {
  const [pin, setPin] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const lock = useRef(false);
  const input = useRef(null);
  const press = key => {
    if (lock.current) return;
    setError("");
    setPin(value => key === "del" ? value.slice(0, -1) : (value + key).slice(0, 8));
  };
  const submit = async event => {
    event.preventDefault();
    if (pin.length < 4 || lock.current) return;
    lock.current = true; setBusy(true); setError("");
    try { onSignedIn?.(await callApi("/auth/login", { method: "POST", body: JSON.stringify({ pin }) })); }
    catch (problem) { setError(problem.message); setPin(""); input.current?.focus(); }
    finally { lock.current = false; setBusy(false); }
  };
  return <div className="staff-login">
    <form className="pin-card" onSubmit={submit} aria-busy={busy}>
      <span className="pin-brand"><UtensilsCrossed size={22}/></span>
      <span className="staff-eyebrow">BẾP NHÀ · NỘI BỘ</span>
      <h1>Chào bạn, vào ca thôi.</h1><p>Đăng nhập bằng mã PIN cá nhân.</p>
      <label className="pin-label" htmlFor="staff-pin">Mã PIN · 4–8 chữ số</label>
      <input ref={input} id="staff-pin" className="pin-input" type="password" inputMode="numeric" autoComplete="current-password"
        maxLength={8} value={pin} readOnly={busy} autoFocus aria-invalid={!!error} aria-describedby={error ? "pin-error" : undefined}
        onChange={event => { setPin(event.target.value.replace(/\D/g, "").slice(0, 8)); setError(""); }}/>
      <div id="pin-error"><ErrorNotice error={error}/></div>
      <div className="pin-pad">{KEYS.map(key => key === "" ? <span key="empty"/> :
        <button type="button" key={key} disabled={busy} onClick={() => press(key)} aria-label={key === "del" ? "Xóa một chữ số" : key}>
          {key === "del" ? <Delete size={22}/> : key}
        </button>)}</div>
      <button className="pin-submit" type="submit" disabled={pin.length < 4 || busy}>{busy ? "Đang kiểm tra…" : <>Đăng nhập <LogIn size={18}/></>}</button>
      <Link className="pin-home" to="/demo">Về trang khách hàng</Link>
    </form>
  </div>;
}

export function RequireStaff({ roles, children }) {
  const { staff, setStaff, refresh, error } = useStaff();
  if (error && staff === undefined) return <div className="staff-login"><div className="pin-card"><h1>Chưa kết nối được</h1><ErrorNotice error={error} retry={refresh}/></div></div>;
  if (staff === undefined) return <div className="staff-login"><p className="pin-card" role="status">Đang kiểm tra đăng nhập…</p></div>;
  if (!staff) return <StaffLogin onSignedIn={setStaff}/>;
  return <StaffShell key={staff.id} staff={staff} setStaff={setStaff} sessionError={error} onRetry={refresh}>
    {roles && !roles.includes(staff.role) ? <main className="staff-main"><div className="staff-empty"><h1>Không có quyền truy cập</h1><p>Tài khoản {ROLE_LABELS[staff.role]} không mở được màn hình này. Chọn màn hình phù hợp phía trên hoặc đăng xuất để đổi tài khoản.</p></div></main>
      : typeof children === "function" ? children(staff, setStaff) : children}
  </StaffShell>;
}
