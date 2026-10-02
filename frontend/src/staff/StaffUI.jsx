import React, { useEffect, useRef, useState } from "react";
import { NavLink } from "react-router-dom";
import { ChefHat, LogOut, Receipt, UtensilsCrossed, X } from "lucide-react";
import { callApi, ROLE_LABELS } from "./staff-api.js";

export function StaffShell({ staff, setStaff, children, sessionError, onRetry }) {
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const lock = useRef(false);
  const logout = async () => {
    if (lock.current) return;
    lock.current = true; setBusy(true); setError("");
    try { await callApi("/auth/logout", { method: "POST" }); setStaff(null); }
    catch (problem) { setError(problem.message); }
    finally { lock.current = false; setBusy(false); }
  };
  const links = [
    { to: "/kitchen", label: "Bếp", icon: ChefHat, roles: ["kitchen", "manager"] },
    { to: "/cashier", label: "Thu ngân", icon: Receipt, roles: ["cashier", "manager"] },
    { to: "/menu-admin", label: "Thực đơn", icon: UtensilsCrossed, roles: ["kitchen", "manager"] },
  ];
  return <div className="staff-page staff-shell">
    <a className="staff-skip" href="#staff-content">Đến nội dung chính</a>
    <header className="staff-bar">
      <div className="staff-brand"><span><UtensilsCrossed size={19}/></span><div>BẾP NHÀ<small>KHÔNG GIAN NHÂN VIÊN</small></div></div>
      <div className="staff-who"><div><strong>{staff.name}</strong><small>{ROLE_LABELS[staff.role]}</small></div>
        <button onClick={logout} disabled={busy} aria-label="Đăng xuất" title="Đăng xuất"><LogOut size={19}/></button>
      </div>
    </header>
    <nav className="staff-nav" aria-label="Màn hình nhân viên">{links.filter(link => link.roles.includes(staff.role)).map(({ to, label, icon: Icon }) =>
      <NavLink key={to} to={to}><Icon size={18}/>{label}</NavLink>)}</nav>
    {error && <div className="staff-main staff-notice"><ErrorNotice error={error}/></div>}
    {sessionError && <div className="staff-main staff-notice"><ErrorNotice error={sessionError} retry={onRetry}/></div>}
    <div id="staff-content" tabIndex={-1}>{children}</div>
  </div>;
}

export function ErrorNotice({ error, retry }) {
  if (!error) return null;
  return <div className="staff-error" role="alert"><span>{error}</span>{retry && <button className="ghost" onClick={retry}>Thử lại</button>}</div>;
}

export function PageHeading({ eyebrow, title, description, connection }) {
  return <div className="staff-heading"><div><span className="staff-eyebrow">{eyebrow}</span><h1>{title}</h1><p>{description}</p></div>
    {connection && <span className={`staff-connection ${connection}`} role="status"><i/>{connection === "live" ? "Đang cập nhật" : "Đang kết nối lại…"}</span>}
  </div>;
}

// Native modal provides keyboard focus containment and makes the background inert.
export function StaffDialog({ title, children, onClose, busy = false }) {
  const ref = useRef(null);
  const titleId = React.useId();
  useEffect(() => {
    const dialog = ref.current;
    const previous = document.activeElement;
    const overflow = document.body.style.overflow;
    dialog.showModal(); document.body.style.overflow = "hidden";
    return () => { dialog.close(); document.body.style.overflow = overflow; previous?.focus(); };
  }, []);
  return <dialog ref={ref} className="staff-dialog" aria-labelledby={titleId} aria-busy={busy}
    onCancel={event => { event.preventDefault(); if (!busy) onClose(); }}>
    <div className="staff-dialog-head"><h2 id={titleId}>{title}</h2><button type="button" className="icon" disabled={busy} onClick={onClose} aria-label="Đóng"><X size={20}/></button></div>
    {children}
  </dialog>;
}
