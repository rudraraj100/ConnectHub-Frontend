import { Component, OnInit, inject, PLATFORM_ID, ChangeDetectionStrategy, ChangeDetectorRef } from '@angular/core';
import { CommonModule, isPlatformBrowser } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { AdminService, AdminUser, AdminRoom, UserReport } from './admin.service';

interface AuditLog {
  id: number;
  action: string;
  target: string;
  by: string;
  time: string;
}

@Component({
  selector: 'app-admin',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './admin.component.html',
  styleUrls: ['./admin.component.css'],
  changeDetection: ChangeDetectionStrategy.OnPush   // prevents NG0100 on totalUsers getter
})
export class AdminComponent implements OnInit {

  private router   = inject(Router);
  private platform = inject(PLATFORM_ID);
  private adminSvc = inject(AdminService);
  private cdr      = inject(ChangeDetectorRef);

  // No hardcoded email — adminship is determined by user.role === 'PLATFORM_ADMIN' from the DB

  activeSection: 'overview' | 'users' | 'rooms' | 'broadcast' | 'reports' | 'logs' = 'overview';

  // ── Data ──────────────────────────────────────────────────────────────────
  users:   AdminUser[]  = [];
  rooms:   AdminRoom[]  = [];
  reports: UserReport[] = [];
  logs:    AuditLog[]   = [];

  // ── Loading / error flags ─────────────────────────────────────────────────
  isLoadingUsers   = true;
  isLoadingRooms   = true;
  isLoadingReports = false;
  errorUsers       = '';
  errorRooms       = '';
  errorReports     = '';

  // ── Broadcast ────────────────────────────────────────────────────────────
  broadcastTitle   = '';
  broadcastMsg     = '';
  broadcastSent    = false;
  broadcastError   = '';
  isSendingBroadcast = false;

  // ── Computed stats ────────────────────────────────────────────────────────
  get totalUsers()      { return this.users.length; }
  get activeUsers()     { return this.users.filter(u => u.isActive).length; }
  get suspendedUsers()  { return this.users.filter(u => !u.isActive).length; }
  get totalRooms()      { return this.rooms.length; }
  get groupRooms()      { return this.rooms.filter(r => r.type === 'GROUP').length; }
  get pendingReports()  { return this.reports.filter(r => r.status === 'PENDING').length; }

  // ── Lifecycle ─────────────────────────────────────────────────────────────
  ngOnInit() {
    if (!isPlatformBrowser(this.platform)) return;

    // Auth guard — must be logged in as admin
    const token = localStorage.getItem('jwt_token');
    if (!token) { this.router.navigate(['/login']); return; }

    const raw = localStorage.getItem('current_user');
    if (raw) {
      try {
        const u = JSON.parse(raw);
        if ((u?.role || '') !== 'PLATFORM_ADMIN') { this.router.navigate(['/chat']); return; }
      } catch { this.router.navigate(['/chat']); return; }
    } else { this.router.navigate(['/chat']); return; }

    this.loadUsers();
    this.loadRooms();
    this.loadReports();
  }

  // ── Data loaders ─────────────────────────────────────────────────────────

  loadUsers() {
    this.isLoadingUsers = true;
    this.errorUsers     = '';
    this.adminSvc.getUsers().subscribe({
      next: users => {
        this.users          = users;
        this.isLoadingUsers = false;
        this.cdr.markForCheck();
      },
      error: () => {
        this.errorUsers     = 'Failed to load users. Is auth-service running?';
        this.isLoadingUsers = false;
        this.cdr.markForCheck();
      }
    });
  }

  loadRooms() {
    this.isLoadingRooms = true;
    this.errorRooms     = '';
    this.adminSvc.getRooms().subscribe({
      next: rooms => {
        this.rooms          = rooms;
        this.isLoadingRooms = false;
        this.cdr.markForCheck();
      },
      error: () => {
        this.errorRooms     = 'Failed to load rooms. Is room-service running?';
        this.isLoadingRooms = false;
        this.cdr.markForCheck();
      }
    });
  }

  // ── User actions ──────────────────────────────────────────────────────────

  toggleUserStatus(u: AdminUser) {
    const prevState = u.isActive;
    this.adminSvc.toggleUser(u.userId).subscribe({
      next: updated => {
        if (updated) {
          // Update in-place so the table re-renders immediately
          const idx = this.users.findIndex(x => x.userId === u.userId);
          if (idx >= 0) this.users[idx] = updated;
          this.addLog(
            updated.isActive ? 'Reactivated user' : 'Suspended user',
            updated.fullName || updated.username
          );
        }
      },
      error: () => {
        // Revert optimistic update
        u.isActive = prevState;
      }
    });
  }

  deleteUser(u: AdminUser) {
    if (!confirm(`Permanently delete "${u.fullName || u.username}"? This cannot be undone.`)) return;
    this.adminSvc.deleteUser(u.userId).subscribe({
      next: ok => {
        if (ok) {
          this.users = this.users.filter(x => x.userId !== u.userId);
          // Also remove from reports list if present
          this.reports = this.reports.filter(r => r.reportedUserId !== u.userId);
          this.addLog('Deleted user', u.fullName || u.username);
        }
      }
    });
  }

  // ── Room actions ──────────────────────────────────────────────────────────

  deleteRoom(r: AdminRoom) {
    if (!confirm(`Delete room "${r.name}"? All messages will be lost.`)) return;
    this.adminSvc.deleteRoom(r.roomId).subscribe({
      next: ok => {
        if (ok) {
          this.rooms = this.rooms.filter(x => x.roomId !== r.roomId);
          this.addLog('Deleted room', r.name);
        }
      }
    });
  }

  // ── Broadcast ─────────────────────────────────────────────────────────────

  sendBroadcast() {
    if (!this.broadcastMsg.trim() || !this.broadcastTitle.trim()) return;
    this.isSendingBroadcast = true;
    this.broadcastError     = '';

    const recipientIds = this.users.map(u => u.userId);
    this.adminSvc.broadcast(recipientIds, this.broadcastTitle, this.broadcastMsg).subscribe({
      next: ok => {
        this.isSendingBroadcast = false;
        if (ok) {
          this.addLog('Broadcast sent', `${recipientIds.length} users`);
          this.broadcastSent  = true;
          this.broadcastTitle = '';
          this.broadcastMsg   = '';
          setTimeout(() => this.broadcastSent = false, 4000);
        } else {
          this.broadcastError = 'Broadcast failed. Check notification-service.';
        }
      },
      error: () => {
        this.isSendingBroadcast = false;
        this.broadcastError = 'Broadcast failed. Check notification-service.';
      }
    });
  }

  // ── Helpers ───────────────────────────────────────────────────────────────

  loadReports() {
    this.isLoadingReports = true;
    this.errorReports     = '';
    this.adminSvc.getReports().subscribe({
      next: reports => {
        this.reports          = reports;
        this.isLoadingReports = false;
        this.cdr.markForCheck();
      },
      error: () => {
        this.errorReports     = 'Failed to load reports.';
        this.isLoadingReports = false;
        this.cdr.markForCheck();
      }
    });
  }

  resolveReport(report: UserReport) {
    this.adminSvc.updateReportStatus(report.reportId, 'RESOLVED').subscribe({
      next: updated => {
        if (updated) {
          const idx = this.reports.findIndex(r => r.reportId === report.reportId);
          if (idx >= 0) this.reports[idx] = updated;
          this.addLog('Resolved report', `${report.reportedUsername} (${report.reason})`);
          this.cdr.markForCheck();
        }
      }
    });
  }

  dismissReport(report: UserReport) {
    this.adminSvc.updateReportStatus(report.reportId, 'DISMISSED').subscribe({
      next: updated => {
        if (updated) {
          const idx = this.reports.findIndex(r => r.reportId === report.reportId);
          if (idx >= 0) this.reports[idx] = updated;
          this.addLog('Dismissed report', `${report.reportedUsername} (${report.reason})`);
          this.cdr.markForCheck();
        }
      }
    });
  }

  suspendFromReport(report: UserReport) {
    const user = this.users.find(u => u.userId === report.reportedUserId);
    if (!user) {
      alert(`User "${report.reportedUsername}" not found in user list. Refresh users first.`);
      return;
    }
    if (!user.isActive) {
      alert(`"${report.reportedUsername}" is already suspended.`);
      return;
    }
    this.adminSvc.toggleUser(user.userId).subscribe({
      next: updated => {
        if (updated) {
          const idx = this.users.findIndex(u => u.userId === user.userId);
          if (idx >= 0) this.users[idx] = updated;
          this.addLog('Suspended user (from report)', report.reportedUsername);
          // Auto-resolve the report
          this.resolveReport(report);
          this.cdr.markForCheck();
        }
      }
    });
  }

  deleteFromReport(report: UserReport) {
    if (!confirm(`Permanently delete user "${report.reportedUsername}"? This cannot be undone.`)) return;
    this.adminSvc.deleteUser(report.reportedUserId).subscribe({
      next: ok => {
        if (ok) {
          this.users    = this.users.filter(u => u.userId !== report.reportedUserId);
          this.reports  = this.reports.filter(r => r.reportedUserId !== report.reportedUserId);
          this.addLog('Deleted user (from report)', report.reportedUsername);
          this.cdr.markForCheck();
        }
      }
    });
  }

  private addLog(action: string, target: string) {
    this.logs.unshift({
      id:     Date.now(),
      action,
      target,
      by:     'Admin',
      time:   new Date().toLocaleString('en-IN', { hour12: true }),
    });
  }

  formatDate(iso: string | null): string {
    if (!iso) return '—';
    return new Date(iso).toLocaleDateString('en-CA');   // YYYY-MM-DD
  }

  avatarLetter(u: AdminUser): string {
    return (u.fullName || u.username || '?').charAt(0).toUpperCase();
  }

  goBack() { this.router.navigate(['/chat']); }
}
