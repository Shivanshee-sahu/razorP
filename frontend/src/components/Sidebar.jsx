import React from 'react';
import { NavLink } from 'react-router-dom';

export default function Sidebar() {
  return (
    <aside className="sidebar">
      <div className="brand">
        <h2>COPPER & CHAR</h2>
        <small>AI Commerce Engine</small>
      </div>

      <nav className="nav-groups">
        <div className="nav-group">
          <span className="group-label">COMMERCE</span>
          <NavLink to="/">Dashboard</NavLink>
          <NavLink to="/products">Products</NavLink>
          <NavLink to="/cart">Cart</NavLink>
          <NavLink to="/orders">Orders</NavLink>
        </div>

        <div className="nav-group">
          <span className="group-label">AGENTS</span>
          <NavLink to="/buyer">◇ AI Buyer</NavLink>
          <NavLink to="/growth">✦ Growth AI</NavLink>
        </div>

        <div className="nav-group">
          <span className="group-label">GOVERNANCE</span>
          <NavLink to="/approvals">Approvals</NavLink>
          <NavLink to="/policy">Policy Center</NavLink>
          <NavLink to="/lab">Agent Test Lab</NavLink>
          <NavLink to="/audit">Audit Trail</NavLink>
        </div>
      </nav>
    </aside>
  );
}