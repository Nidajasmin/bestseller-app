import React, { useState, useCallback } from "react";
import { useNavigate, useLocation } from "react-router";
import { Popover, ActionList } from "@shopify/polaris";

export function TopNavbar() {
  const navigate = useNavigate();
  const location = useLocation();
  const [activeMenu, setActiveMenu] = useState<string | null>(null);
  const [hoveredItem, setHoveredItem] = useState<string | null>(null);

  // Navigation items
  const navItems = [
    { label: "Dashboard", path: "/app/collections_list", hasDropdown: false },
    { label: "Tags & Collection Manager", path: "/app/Tags-collection_Manager", hasDropdown: false },
    {
      label: "Statistics",
      path: "/app/statistics",
      hasDropdown: true,
      submenu: [
        { content: "Bestsellers", path: "/app/Bestsellers" },
        { content: "Trending", path: "/app/Trending" },
        { content: "Aging Inventory", path: "/app/Aging" },
        { content: "New Arrivals", path: "/app/NewArrivals" },
      ],
    },
  ];

  const activeSection =
    navItems.find((item) => location.pathname.startsWith(item.path))?.label ||
    "RE-SORT APP";

  // Fast navigation handler
  const handleNavigation = useCallback((path: string) => {
    navigate(path);
    setActiveMenu(null);
  }, [navigate]);

  // Check if item is active
  const isItemActive = useCallback((itemPath: string) => {
    return location.pathname.startsWith(itemPath);
  }, [location.pathname]);

  // Get item color based on state
  const getItemColor = useCallback((item: typeof navItems[0]) => {
    if (isItemActive(item.path)) return "#00AEEF";
    if (hoveredItem === item.label || activeMenu === item.label) return "#00AEEF";
    return "rgba(255,255,255,0.85)";
  }, [isItemActive, hoveredItem, activeMenu]);

  // Get item font weight based on state
  const getItemFontWeight = useCallback((item: typeof navItems[0]) => {
    if (isItemActive(item.path)) return 600;
    if (hoveredItem === item.label || activeMenu === item.label) return 500;
    return 400;
  }, [isItemActive, hoveredItem, activeMenu]);

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
      <div style={{ display: "flex", alignItems: "center", gap: "32px" }}>
        {navItems.map((item) =>
          item.hasDropdown ? (
            <Popover
              key={item.label}
              active={activeMenu === item.label}
              activator={
                <div
                  onClick={() => {
                    setActiveMenu(activeMenu === item.label ? null : item.label);
                  }}
                  onMouseEnter={() => setHoveredItem(item.label)}
                  onMouseLeave={() => setHoveredItem(null)}
                  style={{
                    color: getItemColor(item),
                    cursor: "pointer",
                    fontSize: "15px",
                    fontWeight: getItemFontWeight(item),
                    transition: "all 0.2s ease",
                    padding: "8px 12px",
                    borderRadius: "4px",
                    backgroundColor: 
                      activeMenu === item.label 
                        ? "rgba(0, 174, 239, 0.1)" 
                        : hoveredItem === item.label 
                        ? "rgba(255, 255, 255, 0.05)" 
                        : "transparent",
                  }}
                >
                  {item.label}
                  <span 
                    style={{ 
                      marginLeft: "4px",
                      transform: activeMenu === item.label ? "rotate(180deg)" : "rotate(0deg)",
                      transition: "transform 0.2s ease",
                      display: "inline-block"
                    }}
                  >
                    ▼
                  </span>
                </div>
              }
              onClose={() => setActiveMenu(null)}
            >
              <ActionList
                items={item.submenu?.map((sub) => ({
                  content: sub.content,
                  onAction: () => handleNavigation(sub.path),
                }))}
              />
            </Popover>
          ) : (
            <div
              key={item.path}
              onClick={() => handleNavigation(item.path)}
              onMouseEnter={() => setHoveredItem(item.label)}
              onMouseLeave={() => setHoveredItem(null)}
              style={{
                color: getItemColor(item),
                cursor: "pointer",
                fontSize: "15px",
                fontWeight: getItemFontWeight(item),
                transition: "all 0.2s ease",
                padding: "8px 16px",
                borderRadius: "4px",
                backgroundColor: 
                  isItemActive(item.path)
                    ? "rgba(0, 174, 239, 0.1)"
                    : hoveredItem === item.label
                    ? "rgba(255, 255, 255, 0.05)"
                    : "transparent",
                border: isItemActive(item.path) ? "1px solid rgba(0, 174, 239, 0.3)" : "1px solid transparent",
              }}
            >
              {item.label}
            </div>
          )
        )}
      </div>
    </div>
  );
}