import { Component, OnInit, inject, PLATFORM_ID } from '@angular/core';
import { CommonModule, isPlatformBrowser } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { ChatService } from '../chat/chat.service';

interface UserRow  { id:number; name:string; email:string; role:string; status:'active'|'suspended'; joined:string; }
interface RoomRow  { id:number; name:string; members:number; messages:number; created:string; }
interface AuditLog { id:number; action:string; target:string; by:string; time:string; }

@Component({
  selector: 'app-admin',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './admin.component.html',
  styleUrls: ['./admin.component.css']
})
export class AdminComponent implements OnInit {
  private router   = inject(Router);
  private platform = inject(PLATFORM_ID);
  private chatSvc  = inject(ChatService);

  activeSection: 'overview'|'users'|'rooms'|'broadcast'|'logs' = 'overview';
  broadcastMsg = '';
  broadcastSent = false;
  isLoadingUsers = false;

  users: UserRow[] = [
    {id:1,name:'Ananya Sharma',  email:'ananya.sharma@gmail.com', role:'Member',  status:'active',   joined:'2026-01-12'},
    {id:2,name:'Rahul Verma',    email:'rahul.verma@gmail.com',   role:'Member',  status:'active',   joined:'2026-01-18'},
    {id:3,name:'Priya Nair',     email:'priya.nair@gmail.com',    role:'Member',  status:'suspended',joined:'2026-02-05'},
    {id:4,name:'Arjun Kapoor',   email:'arjun.kapoor@gmail.com',  role:'Member',  status:'active',   joined:'2026-02-14'},
    {id:5,name:'Sneha Joshi',    email:'sneha.joshi@gmail.com',   role:'Member',  status:'active',   joined:'2026-03-02'},
    {id:6,name:'Vikram Mehta',   email:'vikram.mehta@gmail.com',  role:'Member',  status:'suspended',joined:'2026-03-19'},
    {id:7,name:'Rudra Raj',      email:'rudrar2002@gmail.com',    role:'Admin',   status:'active',   joined:'2025-12-01'},
  ];

  rooms: RoomRow[] = [
    {id:1,name:'UI/UX Designing',  members:12,messages:847, created:'2026-01-15'},
    {id:2,name:'Web Development',  members:18,messages:2341,created:'2026-01-20'},
    {id:3,name:'Product Strategy', members:7, messages:412, created:'2026-02-08'},
    {id:4,name:'Design Reviews',   members:5, messages:189, created:'2026-02-22'},
    {id:5,name:'DevOps Channel',   members:9, messages:673, created:'2026-03-10'},
  ];

  logs: AuditLog[] = [
    {id:1,action:'Suspended user',  target:'Priya Nair',     by:'Rudra Raj',time:'2026-04-22 11:30'},
    {id:2,action:'Deleted message', target:'Web Dev Room',   by:'Rudra Raj',time:'2026-04-22 10:15'},
    {id:3,action:'Suspended user',  target:'Vikram Mehta',   by:'Rudra Raj',time:'2026-04-21 16:45'},
    {id:4,action:'Broadcast sent',  target:'All users',      by:'Rudra Raj',time:'2026-04-20 09:00'},
    {id:5,action:'Deleted room',    target:'Test Room',      by:'Rudra Raj',time:'2026-04-19 14:22'},
  ];

  get totalUsers()    { return this.users.length; }
  get activeUsers()   { return this.users.filter(u=>u.status==='active').length; }
  get suspendedUsers(){ return this.users.filter(u=>u.status==='suspended').length; }
  get totalRooms()    { return this.rooms.length; }
  get totalMessages() { return this.rooms.reduce((a,r)=>a+r.messages,0); }

  ngOnInit() {
    if (!isPlatformBrowser(this.platform)) return;
    const token = localStorage.getItem('jwt_token');
    if (!token) { this.router.navigate(['/login']); return; }
    const raw = localStorage.getItem('current_user');
    if (raw) {
      try {
        const u = JSON.parse(raw);
        const email = u?.email || '';
        if (email !== 'rudrar2002@gmail.com') { this.router.navigate(['/chat']); return; }
      } catch { this.router.navigate(['/chat']); }
    } else { this.router.navigate(['/chat']); }

    // Try to load real users from auth service
    this.isLoadingUsers = true;
    this.chatSvc.searchUsers('').subscribe({
      next: (users) => {
        if (users && users.length > 0) {
          this.users = users.map(u => ({
            id: u.userId as any,
            name: u.fullName || u.username,
            email: u.email,
            role: u.email === 'rudrar2002@gmail.com' ? 'Admin' : 'Member',
            status: (u.isActive ? 'active' : 'suspended') as any,
            joined: u.createdAt ? new Date(u.createdAt).toLocaleDateString('en-CA') : '—'
          }));
        }
        this.isLoadingUsers = false;
      },
      error: () => { this.isLoadingUsers = false; /* keep mock data */ }
    });
  }

  toggleUserStatus(u: UserRow) {
    u.status = u.status === 'active' ? 'suspended' : 'active';
    this.logs.unshift({
      id: Date.now(), action: u.status==='suspended' ? 'Suspended user' : 'Reactivated user',
      target: u.name, by:'Rudra Raj', time: new Date().toLocaleString()
    });
  }
  deleteUser(u: UserRow) {
    if(!confirm(`Permanently delete ${u.name}?`)) return;
    this.users = this.users.filter(x=>x.id!==u.id);
    this.logs.unshift({id:Date.now(),action:'Deleted user',target:u.name,by:'Rudra Raj',time:new Date().toLocaleString()});
  }
  deleteRoom(r: RoomRow) {
    if(!confirm(`Delete room "${r.name}"?`)) return;
    this.rooms = this.rooms.filter(x=>x.id!==r.id);
    this.logs.unshift({id:Date.now(),action:'Deleted room',target:r.name,by:'Rudra Raj',time:new Date().toLocaleString()});
  }
  sendBroadcast() {
    if(!this.broadcastMsg.trim()) return;
    this.logs.unshift({id:Date.now(),action:'Broadcast sent',target:'All users',by:'Rudra Raj',time:new Date().toLocaleString()});
    this.broadcastSent = true;
    this.broadcastMsg = '';
    setTimeout(()=>this.broadcastSent=false, 3000);
  }
  goBack() { this.router.navigate(['/chat']); }
}
