import {
  Component, signal, computed, inject, PLATFORM_ID,
  OnInit, OnDestroy, HostListener
} from '@angular/core';
import { CommonModule, isPlatformBrowser } from '@angular/common';
import {
  FormBuilder, FormGroup, Validators, ReactiveFormsModule,
  AbstractControl, ValidationErrors
} from '@angular/forms';
import { Router, RouterModule } from '@angular/router';
import { Subject, Subscription } from 'rxjs';
import { debounceTime, distinctUntilChanged, filter, switchMap } from 'rxjs/operators';
import { AuthService } from '../auth.service';

// ── Country codes list ────────────────────────────────────────────
export interface Country { code: string; name: string; dial: string; flag: string; }
export const COUNTRY_CODES: Country[] = [
  { code: 'IN', name: 'India',               dial: '+91',  flag: '🇮🇳' },
  { code: 'US', name: 'United States',       dial: '+1',   flag: '🇺🇸' },
  { code: 'GB', name: 'United Kingdom',      dial: '+44',  flag: '🇬🇧' },
  { code: 'AU', name: 'Australia',           dial: '+61',  flag: '🇦🇺' },
  { code: 'CA', name: 'Canada',              dial: '+1',   flag: '🇨🇦' },
  { code: 'DE', name: 'Germany',             dial: '+49',  flag: '🇩🇪' },
  { code: 'FR', name: 'France',              dial: '+33',  flag: '🇫🇷' },
  { code: 'JP', name: 'Japan',               dial: '+81',  flag: '🇯🇵' },
  { code: 'CN', name: 'China',               dial: '+86',  flag: '🇨🇳' },
  { code: 'BR', name: 'Brazil',              dial: '+55',  flag: '🇧🇷' },
  { code: 'MX', name: 'Mexico',              dial: '+52',  flag: '🇲🇽' },
  { code: 'ZA', name: 'South Africa',        dial: '+27',  flag: '🇿🇦' },
  { code: 'NG', name: 'Nigeria',             dial: '+234', flag: '🇳🇬' },
  { code: 'RU', name: 'Russia',              dial: '+7',   flag: '🇷🇺' },
  { code: 'KR', name: 'South Korea',         dial: '+82',  flag: '🇰🇷' },
  { code: 'IT', name: 'Italy',               dial: '+39',  flag: '🇮🇹' },
  { code: 'ES', name: 'Spain',               dial: '+34',  flag: '🇪🇸' },
  { code: 'NL', name: 'Netherlands',         dial: '+31',  flag: '🇳🇱' },
  { code: 'SG', name: 'Singapore',           dial: '+65',  flag: '🇸🇬' },
  { code: 'AE', name: 'United Arab Emirates',dial: '+971', flag: '🇦🇪' },
  { code: 'SA', name: 'Saudi Arabia',        dial: '+966', flag: '🇸🇦' },
  { code: 'PK', name: 'Pakistan',            dial: '+92',  flag: '🇵🇰' },
  { code: 'BD', name: 'Bangladesh',          dial: '+880', flag: '🇧🇩' },
  { code: 'ID', name: 'Indonesia',           dial: '+62',  flag: '🇮🇩' },
  { code: 'MY', name: 'Malaysia',            dial: '+60',  flag: '🇲🇾' },
  { code: 'TH', name: 'Thailand',            dial: '+66',  flag: '🇹🇭' },
  { code: 'VN', name: 'Vietnam',             dial: '+84',  flag: '🇻🇳' },
  { code: 'PH', name: 'Philippines',         dial: '+63',  flag: '🇵🇭' },
  { code: 'TR', name: 'Turkey',              dial: '+90',  flag: '🇹🇷' },
  { code: 'EG', name: 'Egypt',               dial: '+20',  flag: '🇪🇬' },
  { code: 'KE', name: 'Kenya',               dial: '+254', flag: '🇰🇪' },
  { code: 'GH', name: 'Ghana',               dial: '+233', flag: '🇬🇭' },
  { code: 'AR', name: 'Argentina',           dial: '+54',  flag: '🇦🇷' },
  { code: 'CO', name: 'Colombia',            dial: '+57',  flag: '🇨🇴' },
  { code: 'SE', name: 'Sweden',              dial: '+46',  flag: '🇸🇪' },
  { code: 'NO', name: 'Norway',              dial: '+47',  flag: '🇳🇴' },
  { code: 'CH', name: 'Switzerland',         dial: '+41',  flag: '🇨🇭' },
  { code: 'PT', name: 'Portugal',            dial: '+351', flag: '🇵🇹' },
  { code: 'NZ', name: 'New Zealand',         dial: '+64',  flag: '🇳🇿' },
  { code: 'IL', name: 'Israel',              dial: '+972', flag: '🇮🇱' },
  { code: 'PL', name: 'Poland',              dial: '+48',  flag: '🇵🇱' },
  { code: 'UA', name: 'Ukraine',             dial: '+380', flag: '🇺🇦' },
  { code: 'AT', name: 'Austria',             dial: '+43',  flag: '🇦🇹' },
  { code: 'BE', name: 'Belgium',             dial: '+32',  flag: '🇧🇪' },
  { code: 'DK', name: 'Denmark',             dial: '+45',  flag: '🇩🇰' },
  { code: 'FI', name: 'Finland',             dial: '+358', flag: '🇫🇮' },
];

function passwordMatchValidator(g: AbstractControl): ValidationErrors | null {
  const pw  = g.get('password')?.value;
  const cpw = g.get('confirmPassword')?.value;
  return pw && cpw && pw !== cpw ? { passwordMismatch: true } : null;
}

const PASSWORD_PATTERN =
  /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&#^()_+=\[\]{};:,.<>?\-])[A-Za-z\d@$!%*?&#^()_+=\[\]{};:,.<>?\-]{8,}$/;

@Component({
  selector: 'app-register',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule, RouterModule],
  templateUrl: './register.component.html',
  styleUrl: './register.component.css'
})
export class RegisterComponent implements OnInit, OnDestroy {

  private fb          = inject(FormBuilder);
  private router      = inject(Router);
  private authService = inject(AuthService);
  private platformId  = inject(PLATFORM_ID);

  readonly GATEWAY_URL = 'http://localhost:8080';

  registerForm: FormGroup = this.fb.group(
    {
      firstName:       ['', [Validators.required, Validators.minLength(2), Validators.maxLength(50)]],
      lastName:        ['', [Validators.required, Validators.minLength(2), Validators.maxLength(50)]],
      username:        ['', [Validators.required, Validators.minLength(3), Validators.maxLength(50),
                             Validators.pattern('^[a-zA-Z0-9_]+$')]],
      country:         [''],
      city:            [''],
      phoneNumber:     ['', [Validators.pattern('^$|^[0-9]{5,15}$')]],
      email:           ['', [Validators.required, Validators.email]],
      password:        ['', [Validators.required, Validators.minLength(8),
                             Validators.pattern(PASSWORD_PATTERN)]],
      confirmPassword: ['', [Validators.required]],
      terms:           [false, [Validators.requiredTrue]]
    },
    { validators: passwordMatchValidator }
  );

  // ── UI signals ──────────────────────────────────────────────────
  showPassword        = signal(false);
  showConfirmPassword = signal(false);
  isLoading           = signal(false);
  registerError       = signal('');

  // Username real-time validation
  usernameSpaceError  = signal(false);
  usernameUnavailable = signal(false);
  checkingUsername    = signal(false);

  // Country code dial selector
  selectedCountry  = signal<Country>(COUNTRY_CODES[0]); // Default: India +91
  showDialDropdown = signal(false);
  dialSearch       = signal('');

  filteredCountries = computed(() => {
    const q = this.dialSearch().toLowerCase();
    return q
      ? COUNTRY_CODES.filter(c =>
          c.name.toLowerCase().includes(q) || c.dial.includes(q))
      : COUNTRY_CODES;
  });

  private usernameCheck$ = new Subject<string>();
  private subs: Subscription[] = [];

  ngOnInit() {
    const sub = this.usernameCheck$.pipe(
      debounceTime(450),
      distinctUntilChanged(),
      filter(v => v.length >= 3 && /^[a-zA-Z0-9_]+$/.test(v)),
      switchMap(username => {
        this.checkingUsername.set(true);
        this.usernameUnavailable.set(false);
        return this.authService.checkUsernameAvailability(username);
      })
    ).subscribe({
      next: (res: any) => {
        this.usernameUnavailable.set(!(res?.data ?? true));
        this.checkingUsername.set(false);
      },
      error: () => this.checkingUsername.set(false)
    });
    this.subs.push(sub);
  }

  ngOnDestroy() {
    this.subs.forEach(s => s.unsubscribe());
    this.usernameCheck$.complete();
  }

  // Close dropdown when clicking outside
  @HostListener('document:click', ['$event'])
  onDocumentClick(e: MouseEvent) {
    const target = e.target as HTMLElement;
    if (!target.closest('.dial-selector-wrap')) {
      this.showDialDropdown.set(false);
    }
  }

  get f() { return this.registerForm.controls; }

  get passwordMismatch() {
    return this.registerForm.hasError('passwordMismatch') && this.f['confirmPassword'].touched;
  }

  passwordError(): string {
    const c = this.f['password'];
    if (!c.touched || !c.invalid) return '';
    if (c.errors?.['required'])  return 'Password is required.';
    if (c.errors?.['minlength']) return 'Password must be at least 8 characters.';
    if (c.errors?.['pattern'])   return 'Must include uppercase, lowercase, number & special character.';
    return '';
  }

  emailError(): string {
    const c = this.f['email'];
    if (!c.touched || !c.invalid) return '';
    if (c.errors?.['required']) return 'Email is required.';
    return 'Please enter a valid email (e.g. user@example.com).';
  }

  // ── Username handlers ─────────────────────────────────────────
  onUsernameKeydown(e: KeyboardEvent) {
    if (e.key === ' ' || e.code === 'Space') { e.preventDefault(); this.usernameSpaceError.set(true); }
  }

  onUsernameInput(e: Event) {
    const input = e.target as HTMLInputElement;
    const clean = input.value.replace(/\s/g, '');
    if (clean !== input.value) {
      input.value = clean;
      this.f['username'].setValue(clean, { emitEvent: false });
      this.usernameSpaceError.set(true);
    } else if (!input.value.includes(' ')) {
      this.usernameSpaceError.set(false);
    }
    if (clean.length >= 3) { this.usernameCheck$.next(clean); }
    else { this.usernameUnavailable.set(false); this.checkingUsername.set(false); }
  }

  // ── Dial code dropdown ────────────────────────────────────────
  toggleDialDropdown(e: MouseEvent) {
    e.stopPropagation();
    this.showDialDropdown.update(v => !v);
    this.dialSearch.set('');
  }

  selectCountry(c: Country, e: MouseEvent) {
    e.stopPropagation();
    this.selectedCountry.set(c);
    this.showDialDropdown.set(false);
    this.dialSearch.set('');
  }

  onDialSearch(e: Event) {
    this.dialSearch.set((e.target as HTMLInputElement).value);
  }

  // ── Toggle password visibility ────────────────────────────────
  togglePassword()        { this.showPassword.update(v => !v); }
  toggleConfirmPassword() { this.showConfirmPassword.update(v => !v); }

  // ── Submit ───────────────────────────────────────────────────
  onRegister() {
    if (this.registerForm.invalid || this.usernameUnavailable()) {
      this.registerForm.markAllAsTouched();
      return;
    }
    this.isLoading.set(true);
    this.registerError.set('');

    const { firstName, lastName, username, country, city, phoneNumber, email, password } =
      this.registerForm.value;

    this.authService.register({
      fullName:    `${firstName.trim()} ${lastName.trim()}`,
      username:    username.trim(),
      email:       email.trim(),
      password,
      country:     country?.trim() || undefined,
      city:        city?.trim() || undefined,
      countryCode: this.selectedCountry().dial,
      phoneNumber: phoneNumber?.trim() || undefined
    }).subscribe({
      next: () => this.router.navigate(['/verify-email-sent'], {
          queryParams: { email: email.trim() }
        }),   // ✅ user must verify email before logging in
      error: (err: any) => {
        this.registerError.set(err.error?.message || 'Registration failed. Please try again.');
        this.isLoading.set(false);
      }
    });
  }

  // ── OAuth ────────────────────────────────────────────────────
  signUpWithGoogle() {
    if (isPlatformBrowser(this.platformId))
      window.location.href = `${this.GATEWAY_URL}/oauth2/authorization/google`;
  }
}
