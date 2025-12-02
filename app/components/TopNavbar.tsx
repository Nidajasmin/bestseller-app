//app/components/TopNavbar.tsx
import React, { useState, useCallback } from "react";
import { useNavigate, useLocation } from "react-router";
import { Popover, ActionList } from "@shopify/polaris";
import { AppLogger } from "../utils/logging";

export function TopNavbar() {
  const navigate = useNavigate();
  const location = useLocation();
  const [activeMenu, setActiveMenu] = useState<string | null>(null);
  const [hoveredItem, setHoveredItem] = useState<string | null>(null);

  // Navigation items
  const navItems = [
    { label: "Dashboard", path: "/app", hasDropdown: false },
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
    AppLogger.info('TopNavbar navigation triggered', {
      from: location.pathname,
      to: path,
      section: activeSection,
      userAgent: navigator.userAgent,
      timestamp: new Date().toISOString()
    });
    
    navigate(path);
    setActiveMenu(null);
  }, [navigate, location.pathname, activeSection]);

  // Check if item is active - FIXED THIS FUNCTION
  const isItemActive = useCallback((itemPath: string) => {
    return location.pathname.startsWith(itemPath); // Changed from item.path to itemPath
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

  // Menu interaction logging
  const handleMenuToggle = useCallback((menuLabel: string) => {
    const isOpening = activeMenu !== menuLabel;
    AppLogger.debug('TopNavbar menu toggled', {
      menu: menuLabel,
      action: isOpening ? 'opened' : 'closed',
      currentPath: location.pathname,
      timestamp: new Date().toISOString()
    });
    
    setActiveMenu(isOpening ? menuLabel : null);
  }, [activeMenu, location.pathname]);

  // Hover logging for debugging
  const handleHover = useCallback((itemLabel: string | null) => {
    setHoveredItem(itemLabel);
    if (itemLabel) {
      AppLogger.debug('TopNavbar item hover', {
        item: itemLabel,
        currentPath: location.pathname,
        timestamp: new Date().toISOString()
      });
    }
  }, [location.pathname]);

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
                    handleMenuToggle(item.label);
                  }}
                  onMouseEnter={() => handleHover(item.label)}
                  onMouseLeave={() => handleHover(null)}
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
              onClose={() => {
                AppLogger.debug('TopNavbar popover closed', { 
                  menu: item.label,
                  timestamp: new Date().toISOString()
                });
                setActiveMenu(null);
              }}
            >
              <ActionList
                items={item.submenu?.map((sub) => ({
                  content: sub.content,
                  onAction: () => {
                    AppLogger.info('TopNavbar submenu navigation', {
                      from: location.pathname,
                      to: sub.path,
                      submenu: sub.content,
                      timestamp: new Date().toISOString(),
                      userAgent: navigator.userAgent
                    });
                    handleNavigation(sub.path);
                  },
                }))}
              />
            </Popover>
          ) : (
            <div
              key={item.path}
              onClick={() => handleNavigation(item.path)}
              onMouseEnter={() => handleHover(item.label)}
              onMouseLeave={() => handleHover(null)}
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