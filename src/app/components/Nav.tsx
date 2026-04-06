'use client'

import { useState, useRef, useEffect } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'

interface NavItem {
  label: string
  href: string
  children?: { label: string; href: string }[]
}

const navLinks: NavItem[] = [
  { label: 'Main Ops Dashboard', href: '/' },
  {
    label: 'B2B Dashboard',
    href: '/b2b',
    children: [
      { label: 'B2B Dashboard', href: '/b2b' },
      { label: 'Customers', href: '/b2b?tab=customers' },
      { label: 'Products', href: '/b2b?tab=products' },
      { label: 'Abandoned Checkouts', href: '/b2b?tab=checkouts' },
      { label: 'Upload Order', href: '/b2b?tab=create-order' },
    ],
  },
  { label: 'Unlisted Products', href: '/unlisted' },
]

export default function Nav() {
  const pathname = usePathname()
  const [open, setOpen] = useState(false)
  const [expandedGroup, setExpandedGroup] = useState<string | null>(null)
  const menuRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setOpen(false)
    }
    if (open) document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [open])

  return (
    <div ref={menuRef} style={{ position: 'relative', display: 'inline-flex' }}>
      <button
        onClick={() => setOpen(v => !v)}
        style={{
          background: open ? 'rgba(255,255,255,0.08)' : 'none',
          border: 'none',
          cursor: 'pointer',
          padding: 6,
          borderRadius: 8,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          transition: 'background 0.2s',
        }}
        aria-label="Menu"
      >
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.55)" strokeWidth="2" strokeLinecap="round">
          {open ? (
            <>
              <line x1="6" y1="6" x2="18" y2="18" />
              <line x1="6" y1="18" x2="18" y2="6" />
            </>
          ) : (
            <>
              <line x1="4" y1="7" x2="20" y2="7" />
              <line x1="4" y1="12" x2="20" y2="12" />
              <line x1="4" y1="17" x2="20" y2="17" />
            </>
          )}
        </svg>
      </button>

      {open && (
        <div style={{
          position: 'absolute',
          top: 'calc(100% + 8px)',
          left: 0,
          background: 'rgba(28, 28, 30, 0.95)',
          backdropFilter: 'blur(40px)',
          WebkitBackdropFilter: 'blur(40px)',
          border: '1px solid rgba(255, 255, 255, 0.08)',
          borderRadius: 12,
          padding: 6,
          minWidth: 220,
          zIndex: 100,
          boxShadow: '0 8px 32px rgba(0,0,0,0.5)',
        }}>
          {navLinks.map(link => {
            const active = pathname === link.href || (link.href === '/b2b' && pathname === '/b2b')
            const isExpanded = expandedGroup === link.label

            if (link.children) {
              return (
                <div key={link.href}>
                  <button
                    onClick={() => setExpandedGroup(isExpanded ? null : link.label)}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      width: '100%',
                      padding: '10px 14px',
                      borderRadius: 8,
                      fontSize: 13,
                      fontWeight: 500,
                      color: active ? '#f5f5f7' : 'rgba(255, 255, 255, 0.55)',
                      background: active ? 'rgba(255, 255, 255, 0.1)' : 'transparent',
                      border: 'none',
                      cursor: 'pointer',
                      textAlign: 'left',
                      fontFamily: 'inherit',
                      transition: 'background 0.15s',
                    }}
                  >
                    {link.label}
                    <span style={{ fontSize: 10, opacity: 0.5, transform: isExpanded ? 'rotate(180deg)' : 'none', transition: 'transform 0.15s' }}>▼</span>
                  </button>
                  {isExpanded && (
                    <div style={{ paddingLeft: 12, paddingBottom: 4 }}>
                      {link.children.map(child => (
                        <a
                          key={child.href}
                          href={child.href}
                          onClick={(e) => { e.preventDefault(); setOpen(false); window.location.href = child.href }}
                          style={{
                            display: 'block',
                            padding: '7px 14px',
                            borderRadius: 6,
                            fontSize: 12,
                            fontWeight: 400,
                            color: 'rgba(255, 255, 255, 0.45)',
                            background: 'transparent',
                            textDecoration: 'none',
                            transition: 'background 0.15s',
                            cursor: 'pointer',
                          }}
                        >
                          {child.label}
                        </a>
                      ))}
                    </div>
                  )}
                </div>
              )
            }

            return (
              <Link
                key={link.href}
                href={link.href}
                onClick={() => setOpen(false)}
                style={{
                  display: 'block',
                  padding: '10px 14px',
                  borderRadius: 8,
                  fontSize: 13,
                  fontWeight: 500,
                  color: active ? '#f5f5f7' : 'rgba(255, 255, 255, 0.55)',
                  background: active ? 'rgba(255, 255, 255, 0.1)' : 'transparent',
                  textDecoration: 'none',
                  transition: 'background 0.15s',
                }}
              >
                {link.label}
              </Link>
            )
          })}
        </div>
      )}
    </div>
  )
}
