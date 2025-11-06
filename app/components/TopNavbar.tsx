import React, { useState } from "react";
import { useNavigate, useLocation } from "react-router";
import { Popover, ActionList } from "@shopify/polaris";

export function TopNavbar() {
  const navigate = useNavigate();
  const location = useLocation();
  const [activeMenu, setActiveMenu] = useState<string | null>(null);

  // Navigation items
  const navItems = [
    { label: "Dashboard", path: "/app/collections_list", hasDropdown: false },
    { label: "Tags & Collection Manager", path: "/app/Tags-collection_Manager", hasDropdown: false },
    {
      label: "Statistics",
      path: "/app/statistics",
      hasDropdown: true,
      submenu: [
        { content: "Bestsellers ", path: "/app/Bestsellers" },
        { content: "Trending", path: "/app/Trending" },
        { content: "Aging Inventory", path: "/app/Aging"},
        { content: "New Arrivals", path: "/app/NewArrivals" },
      ],
    },
  ];

  const activeSection =
    navItems.find((item) => location.pathname.startsWith(item.path))?.label ||
    "RE-SORT APP";

  return (
    <div
      style={{
        backgroundColor: "#1A1D1F",
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        padding: "12px 40px",
        boxShadow: "0px 2px 6px rgba(0,0,0,0.2)",
        position: "relative",
        zIndex: 100,
      }}
    >
      {/* Left Side: Dynamic Label */}
      <div
        style={{
          color: "#FFFFFF",
          fontWeight: 700,
          fontSize: "18px",
          letterSpacing: "0.5px",
        }}
      >
        {activeSection}
      </div>

      {/* Right Side: Navigation */}
      <div style={{ display: "flex", alignItems: "center", gap: "24px" }}>
        {navItems.map((item) =>
          item.hasDropdown ? (
            <Popover
              key={item.label}
              active={activeMenu === item.label}
              activator={
                <span
                  onClick={() =>
                    setActiveMenu(activeMenu === item.label ? null : item.label)
                  }
                  style={{
                    color:
                      location.pathname.startsWith(item.path)
                        ? "#00AEEF"
                        : "rgba(255,255,255,0.85)",
                    cursor: "pointer",
                    fontSize: "15px",
                    fontWeight: location.pathname.startsWith(item.path)
                      ? 600
                      : 400,
                    transition: "color 0.3s ease",
                  }}
                >
                  {item.label}
                </span>
              }
              onClose={() => setActiveMenu(null)}
            >
              <ActionList
                items={item.submenu?.map((sub) => ({
                  content: sub.content,
                  onAction: () => {
                    navigate(sub.path);
                    setActiveMenu(null);
                  },
                }))}
              />
            </Popover>
          ) : (
            <span
              key={item.path}
              onClick={() => navigate(item.path)}
              style={{
                color:
                  location.pathname.startsWith(item.path)
                    ? "#00AEEF"
                    : "rgba(255,255,255,0.85)",
                cursor: "pointer",
                fontSize: "15px",
                fontWeight: location.pathname.startsWith(item.path) ? 600 : 400,
                transition: "color 0.3s ease",
              }}
              onMouseEnter={(e) => (e.currentTarget.style.color = "#00AEEF")}
              onMouseLeave={(e) =>
                (e.currentTarget.style.color = location.pathname.startsWith(
                  item.path
                )
                  ? "#00AEEF"
                  : "rgba(255,255,255,0.85)")
              }
            >
              {item.label}
            </span>
          )
        )}
      </div>
    </div>
  );
}
