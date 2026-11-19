/**
 * Industry templates: a starting point for a portal (branding text, pipeline
 * stages, departments) and for jobs (description, skills, screening questions,
 * healthcare attributes). Pure data, safe to import in the browser and on the
 * server. Everything can be edited after it is applied.
 */
import { z } from 'zod';

export const SHIFTS = [
  'DAY',
  'EVENING',
  'NIGHT',
  'ROTATING',
  'FLEXIBLE',
] as const;
export type Shift = (typeof SHIFTS)[number];

export const SHIFT_LABELS: Record<Shift, string> = {
  DAY: 'Day shift',
  EVENING: 'Evening shift',
  NIGHT: 'Night shift',
  ROTATING: 'Rotating shifts',
  FLEXIBLE: 'Flexible hours',
};

/** Extra, structured facts about a healthcare job. All optional. */
export const jobAttributesSchema = z
  .object({
    specialty: z.string().trim().max(80).optional(),
    shift: z.enum(SHIFTS).optional(),
    licenseRequired: z.boolean().optional(),
    licenseBody: z.string().trim().max(120).optional(),
    certifications: z
      .array(z.string().trim().min(1).max(40))
      .max(15)
      .optional(),
    onCall: z.boolean().optional(),
  })
  .default({});

export type JobAttributes = z.infer<typeof jobAttributesSchema>;

export const CERTIFICATIONS = [
  'BLS',
  'ACLS',
  'PALS',
  'NRP',
  'ATLS',
  'Infection control',
  'CPR',
  'Radiation safety',
  'Phlebotomy',
  'Good Pharmacy Practice',
];

export const SPECIALTIES = [
  'General medicine',
  'Critical care',
  'Emergency',
  'Surgery',
  'Paediatrics',
  'Obstetrics & gynaecology',
  'Cardiology',
  'Oncology',
  'Radiology',
  'Pathology & laboratory',
  'Pharmacy',
  'Rehabilitation',
  'Primary care',
];

export type TemplateQuestion = {
  type: 'TEXT' | 'SINGLE' | 'MULTI' | 'NUMBER' | 'BOOLEAN';
  prompt: string;
  options?: string[];
  required: boolean;
};

export type JobTemplate = {
  key: string;
  category:
    'Nursing' | 'Physicians' | 'Allied health' | 'Pharmacy' | 'Operations';
  title: string;
  department: string;
  employmentType: 'FULL_TIME' | 'PART_TIME' | 'CONTRACT' | 'TEMPORARY';
  experienceMin: number;
  experienceMax: number | null;
  education: string;
  requiredSkills: string[];
  optionalSkills: string[];
  responsibilities: string[];
  benefits: string[];
  descriptionHtml: string;
  questions: TemplateQuestion[];
  attributes: JobAttributes;
};

const licenceQuestions = (body: string): TemplateQuestion[] => [
  {
    type: 'TEXT',
    prompt: `${body} registration number`,
    required: true,
  },
  {
    type: 'BOOLEAN',
    prompt: 'Is your registration current and free of restrictions?',
    required: true,
  },
];

const shiftQuestion: TemplateQuestion = {
  type: 'MULTI',
  prompt: 'Which shifts can you work?',
  options: ['Day', 'Evening', 'Night', 'Weekends', 'On-call'],
  required: true,
};

const BENEFITS = [
  'Health cover for you and your family',
  'Shift allowance',
  'Continuing medical education budget',
  'Paid licence renewal',
];

export const JOB_TEMPLATES: JobTemplate[] = [
  {
    key: 'icu-nurse',
    category: 'Nursing',
    title: 'Registered Nurse, ICU',
    department: 'Intensive Care',
    employmentType: 'FULL_TIME',
    experienceMin: 2,
    experienceMax: 8,
    education: "Bachelor's in Nursing",
    requiredSkills: [
      'Critical care nursing',
      'Ventilator management',
      'Patient monitoring',
    ],
    optionalSkills: ['Dialysis', 'ECMO', 'Electronic medical records'],
    responsibilities: [
      'Deliver one-to-one or one-to-two bedside care to critically ill patients',
      'Manage ventilators, infusion pumps and haemodynamic monitoring',
      'Escalate deterioration early and take part in rapid response',
      'Document care accurately and hand over safely at every shift change',
    ],
    benefits: BENEFITS,
    descriptionHtml:
      '<p>Join our intensive care team and look after patients when they need it most. You will work alongside intensivists, respiratory therapists and pharmacists in a unit that values safe staffing and clear escalation.</p><h3>What you bring</h3><ul><li>Current nursing registration and ICU experience</li><li>Calm judgement under pressure</li><li>Respect for patients and families</li></ul>',
    questions: [...licenceQuestions('Nursing council'), shiftQuestion],
    attributes: {
      specialty: 'Critical care',
      shift: 'ROTATING',
      licenseRequired: true,
      licenseBody: 'Nursing council',
      certifications: ['BLS', 'ACLS'],
      onCall: false,
    },
  },
  {
    key: 'ward-nurse',
    category: 'Nursing',
    title: 'Staff Nurse, General Ward',
    department: 'Nursing',
    employmentType: 'FULL_TIME',
    experienceMin: 0,
    experienceMax: 5,
    education: 'Diploma or degree in Nursing',
    requiredSkills: [
      'Patient care',
      'Medication administration',
      'Vital signs monitoring',
    ],
    optionalSkills: [
      'Wound care',
      'IV cannulation',
      'Electronic medical records',
    ],
    responsibilities: [
      'Provide safe, compassionate nursing care on the ward',
      'Administer medication and treatments as prescribed',
      'Observe, record and report changes in patient condition',
      'Educate patients and families about care and discharge',
    ],
    benefits: BENEFITS,
    descriptionHtml:
      '<p>We are growing our ward nursing team. This is a good first or second role, with a structured induction, a named preceptor and support towards specialisation.</p>',
    questions: [...licenceQuestions('Nursing council'), shiftQuestion],
    attributes: {
      specialty: 'General medicine',
      shift: 'ROTATING',
      licenseRequired: true,
      licenseBody: 'Nursing council',
      certifications: ['BLS'],
    },
  },
  {
    key: 'hospitalist',
    category: 'Physicians',
    title: 'Hospitalist Physician',
    department: 'Internal Medicine',
    employmentType: 'FULL_TIME',
    experienceMin: 3,
    experienceMax: null,
    education: 'MD / MBBS with postgraduate qualification',
    requiredSkills: [
      'Internal medicine',
      'Inpatient care',
      'Clinical documentation',
    ],
    optionalSkills: ['Quality improvement', 'Medical education'],
    responsibilities: [
      'Lead the care of admitted medical patients from admission to discharge',
      'Coordinate with specialists, nursing and case management',
      'Take part in the on-call rota and clinical governance reviews',
      'Supervise and teach junior doctors',
    ],
    benefits: [...BENEFITS, 'Protected academic time'],
    descriptionHtml:
      '<p>Our hospitalist group provides round-the-clock inpatient medicine. We offer block scheduling, strong nursing support and a culture of peer review.</p>',
    questions: [
      ...licenceQuestions('Medical council'),
      {
        type: 'TEXT',
        prompt: 'Postgraduate qualification and year',
        required: true,
      },
    ],
    attributes: {
      specialty: 'General medicine',
      shift: 'ROTATING',
      licenseRequired: true,
      licenseBody: 'Medical council',
      certifications: ['BLS', 'ACLS'],
      onCall: true,
    },
  },
  {
    key: 'emergency-physician',
    category: 'Physicians',
    title: 'Emergency Medicine Physician',
    department: 'Emergency',
    employmentType: 'FULL_TIME',
    experienceMin: 3,
    experienceMax: null,
    education: 'MD / MBBS with emergency medicine training',
    requiredSkills: ['Emergency medicine', 'Trauma care', 'Resuscitation'],
    optionalSkills: ['Point-of-care ultrasound', 'Toxicology'],
    responsibilities: [
      'Assess and stabilise patients presenting with acute illness and injury',
      'Lead resuscitation and trauma teams',
      'Work with admitting and consulting teams on disposition',
      'Maintain accurate triage and handover records',
    ],
    benefits: [...BENEFITS, 'Night differential'],
    descriptionHtml:
      '<p>A busy emergency department with a dedicated resuscitation bay and 24-hour imaging and laboratory support.</p>',
    questions: [...licenceQuestions('Medical council'), shiftQuestion],
    attributes: {
      specialty: 'Emergency',
      shift: 'ROTATING',
      licenseRequired: true,
      licenseBody: 'Medical council',
      certifications: ['ACLS', 'ATLS', 'PALS'],
      onCall: true,
    },
  },
  {
    key: 'lab-technologist',
    category: 'Allied health',
    title: 'Medical Laboratory Technologist',
    department: 'Pathology & Laboratory',
    employmentType: 'FULL_TIME',
    experienceMin: 1,
    experienceMax: 6,
    education: 'BSc / DMLT in Medical Laboratory Technology',
    requiredSkills: ['Clinical chemistry', 'Haematology', 'Quality control'],
    optionalSkills: ['Microbiology', 'LIS software', 'NABL / ISO 15189'],
    responsibilities: [
      'Run and validate routine and urgent laboratory tests',
      'Maintain analysers and complete daily quality control',
      'Record results accurately in the laboratory information system',
      'Follow biosafety and sample handling procedures',
    ],
    benefits: BENEFITS,
    descriptionHtml:
      '<p>Join an accredited laboratory serving inpatients, outpatients and referring clinics. Training on new analysers is provided.</p>',
    questions: [...licenceQuestions('Paramedical council'), shiftQuestion],
    attributes: {
      specialty: 'Pathology & laboratory',
      shift: 'ROTATING',
      licenseRequired: true,
      licenseBody: 'Paramedical council',
      certifications: ['Infection control', 'Phlebotomy'],
    },
  },
  {
    key: 'radiographer',
    category: 'Allied health',
    title: 'Radiology Technologist',
    department: 'Radiology',
    employmentType: 'FULL_TIME',
    experienceMin: 1,
    experienceMax: 8,
    education: 'Diploma or degree in Radiography',
    requiredSkills: ['X-ray', 'CT', 'Patient positioning', 'Radiation safety'],
    optionalSkills: ['MRI', 'Mammography', 'PACS'],
    responsibilities: [
      'Perform diagnostic imaging examinations to protocol',
      'Position and prepare patients, explaining each step',
      'Apply radiation protection and dose optimisation',
      'Maintain image quality and PACS records',
    ],
    benefits: BENEFITS,
    descriptionHtml:
      '<p>Our imaging department runs X-ray, CT, MRI and ultrasound with a modern PACS. You will work closely with radiologists and referring teams.</p>',
    questions: [...licenceQuestions('Radiography board'), shiftQuestion],
    attributes: {
      specialty: 'Radiology',
      shift: 'ROTATING',
      licenseRequired: true,
      licenseBody: 'Radiography board',
      certifications: ['Radiation safety', 'BLS'],
    },
  },
  {
    key: 'physiotherapist',
    category: 'Allied health',
    title: 'Physiotherapist',
    department: 'Rehabilitation',
    employmentType: 'FULL_TIME',
    experienceMin: 1,
    experienceMax: 8,
    education: "Bachelor's in Physiotherapy",
    requiredSkills: [
      'Musculoskeletal assessment',
      'Exercise prescription',
      'Patient education',
    ],
    optionalSkills: ['Neuro rehabilitation', 'Cardiorespiratory physiotherapy'],
    responsibilities: [
      'Assess patients and agree goal-based treatment plans',
      'Deliver hands-on treatment and supervised exercise',
      'Work with nursing and medical teams on discharge planning',
      'Record outcomes and review progress',
    ],
    benefits: BENEFITS,
    descriptionHtml:
      '<p>Work in inpatient and outpatient rehabilitation with a multidisciplinary team and a well-equipped gym.</p>',
    questions: licenceQuestions('Physiotherapy council'),
    attributes: {
      specialty: 'Rehabilitation',
      shift: 'DAY',
      licenseRequired: true,
      licenseBody: 'Physiotherapy council',
      certifications: ['BLS'],
    },
  },
  {
    key: 'clinical-pharmacist',
    category: 'Pharmacy',
    title: 'Clinical Pharmacist',
    department: 'Pharmacy',
    employmentType: 'FULL_TIME',
    experienceMin: 2,
    experienceMax: 8,
    education: 'PharmD / BPharm with MPharm preferred',
    requiredSkills: [
      'Clinical pharmacy',
      'Medication reconciliation',
      'Drug interactions',
    ],
    optionalSkills: ['Antimicrobial stewardship', 'Oncology pharmacy'],
    responsibilities: [
      'Review prescriptions for safety, dose and interactions',
      'Join ward rounds and advise on therapy',
      'Run medication reconciliation at admission and discharge',
      'Report and learn from medication incidents',
    ],
    benefits: BENEFITS,
    descriptionHtml:
      '<p>Be the medicines expert on the ward. You will work with prescribers and nurses to make every treatment safe and effective.</p>',
    questions: licenceQuestions('Pharmacy council'),
    attributes: {
      specialty: 'Pharmacy',
      shift: 'DAY',
      licenseRequired: true,
      licenseBody: 'Pharmacy council',
      certifications: ['Good Pharmacy Practice'],
    },
  },
  {
    key: 'patient-coordinator',
    category: 'Operations',
    title: 'Patient Care Coordinator',
    department: 'Patient Services',
    employmentType: 'FULL_TIME',
    experienceMin: 1,
    experienceMax: 5,
    education: 'Graduate; healthcare administration preferred',
    requiredSkills: [
      'Appointment scheduling',
      'Patient communication',
      'Medical records',
    ],
    optionalSkills: ['Hospital information system', 'Insurance verification'],
    responsibilities: [
      'Greet patients and guide them through registration and billing',
      'Schedule appointments and manage waiting lists',
      'Handle enquiries with courtesy and protect patient privacy',
      'Coordinate with clinical teams on bookings and referrals',
    ],
    benefits: ['Health cover', 'Meal allowance', 'Training and career paths'],
    descriptionHtml:
      '<p>The first friendly face patients meet. You will keep clinics running smoothly and make visits easier for patients and families.</p>',
    questions: [shiftQuestion],
    attributes: {
      shift: 'DAY',
      licenseRequired: false,
      certifications: ['Infection control'],
    },
  },
  {
    key: 'medical-records',
    category: 'Operations',
    title: 'Medical Records Officer',
    department: 'Health Information',
    employmentType: 'FULL_TIME',
    experienceMin: 1,
    experienceMax: 6,
    education: 'Graduate; health information management preferred',
    requiredSkills: ['Medical coding', 'Records management', 'Data privacy'],
    optionalSkills: ['ICD-10', 'CPT', 'Audit'],
    responsibilities: [
      'Maintain accurate, complete and confidential patient records',
      'Code diagnoses and procedures to standard',
      'Respond to record requests under privacy rules',
      'Support audits and data quality checks',
    ],
    benefits: ['Health cover', 'Certification support'],
    descriptionHtml:
      '<p>Keep patient information accurate and secure. This role supports clinical care, billing and quality reporting.</p>',
    questions: [
      {
        type: 'SINGLE',
        prompt: 'Highest coding certification',
        options: ['None', 'CPC', 'CCS', 'Other'],
        required: false,
      },
    ],
    attributes: { shift: 'DAY', licenseRequired: false },
  },
];

export type IndustryKey =
  'general' | 'hospital' | 'clinic' | 'diagnostics' | 'pharmacy';

type StageDef = {
  name: string;
  kind: 'ACTIVE' | 'HIRED' | 'REJECTED' | 'WITHDRAWN';
};

const TERMINAL: StageDef[] = [
  { name: 'Hired', kind: 'HIRED' },
  { name: 'Rejected', kind: 'REJECTED' },
  { name: 'Withdrawn', kind: 'WITHDRAWN' },
];
const active = (...names: string[]): StageDef[] =>
  names.map((name) => ({ name, kind: 'ACTIVE' as const }));

export type IndustryTemplate = {
  key: IndustryKey;
  label: string;
  tagline: string;
  industry: string;
  primaryColor: string;
  heroTitle: string;
  heroSubtitle: string;
  about: string;
  departments: string[];
  /** job template keys suggested for this kind of employer */
  jobs: string[];
  /** null keeps the platform's default pipeline */
  stages: StageDef[] | null;
};

export const INDUSTRY_TEMPLATES: IndustryTemplate[] = [
  {
    key: 'general',
    label: 'General employer',
    tagline: 'The standard pipeline for any company.',
    industry: '',
    primaryColor: '#3346D3',
    heroTitle: 'Build your career with us',
    heroSubtitle: 'Find a role where your work matters.',
    about: '',
    departments: [],
    jobs: [],
    stages: null,
  },
  {
    key: 'hospital',
    label: 'Hospital & health system',
    tagline:
      'Nursing, physicians and allied health with credential and occupational health checks.',
    industry: 'Hospitals & healthcare',
    primaryColor: '#0E7C86',
    heroTitle: 'Care for people. Build a career you are proud of.',
    heroSubtitle:
      'Join clinicians and teams who put patients first, with the training and support to grow.',
    about:
      '<p>We are a multi-specialty hospital committed to safe, compassionate care. Every role here, clinical or not, helps a patient get better.</p><p>We verify every clinical registration, support continuing education and invest in safe staffing.</p>',
    departments: [
      'Nursing',
      'Emergency',
      'Intensive Care',
      'Internal Medicine',
      'Surgery',
      'Radiology',
      'Pathology & Laboratory',
      'Pharmacy',
      'Rehabilitation',
      'Patient Services',
      'Health Information',
    ],
    jobs: [
      'icu-nurse',
      'ward-nurse',
      'hospitalist',
      'emergency-physician',
      'lab-technologist',
      'radiographer',
      'clinical-pharmacist',
      'patient-coordinator',
    ],
    stages: [
      ...active(
        'Applied',
        'AI Shortlisted',
        'Screening',
        'Recruiter Review',
        'Credential Verification',
        'Clinical Interview',
        'Department Head Review',
        'HR Interview',
        'Occupational Health Clearance',
        'Offer'
      ),
      ...TERMINAL,
    ],
  },
  {
    key: 'clinic',
    label: 'Clinic & medical practice',
    tagline:
      'A lean pipeline for practices hiring doctors, nurses and front-desk staff.',
    industry: 'Medical practice',
    primaryColor: '#1F6FEB',
    heroTitle: 'Join a practice where patients know your name',
    heroSubtitle: 'Small teams, long relationships and time to care properly.',
    about:
      '<p>We are a patient-focused practice. You will work in a small team with the time to know your patients and the freedom to practise well.</p>',
    departments: [
      'Primary care',
      'Nursing',
      'Front desk',
      'Allied health',
      'Billing',
    ],
    jobs: [
      'ward-nurse',
      'physiotherapist',
      'patient-coordinator',
      'medical-records',
    ],
    stages: [
      ...active(
        'Applied',
        'AI Shortlisted',
        'Screening',
        'Credential Verification',
        'Practice Interview',
        'Trial Shift',
        'Offer'
      ),
      ...TERMINAL,
    ],
  },
  {
    key: 'diagnostics',
    label: 'Diagnostic lab & imaging',
    tagline:
      'Technologists and pathology staff with a practical assessment step.',
    industry: 'Diagnostics & imaging',
    primaryColor: '#7A3EB1',
    heroTitle: 'Accurate answers start with you',
    heroSubtitle:
      'Work with modern analysers and imaging in an accredited, quality-driven team.',
    about:
      '<p>Our laboratories and imaging centres give clinicians the results they need, fast and right. Quality control and safety are part of every shift.</p>',
    departments: [
      'Pathology & Laboratory',
      'Radiology',
      'Phlebotomy',
      'Quality',
      'Customer service',
    ],
    jobs: ['lab-technologist', 'radiographer', 'medical-records'],
    stages: [
      ...active(
        'Applied',
        'AI Shortlisted',
        'Screening',
        'Registration Check',
        'Practical Assessment',
        'Department Head Review',
        'Offer'
      ),
      ...TERMINAL,
    ],
  },
  {
    key: 'pharmacy',
    label: 'Pharmacy & pharma',
    tagline: 'Pharmacists and pharma staff with a registration check stage.',
    industry: 'Pharmacy & pharmaceuticals',
    primaryColor: '#2E7D32',
    heroTitle: 'Make medicines safer',
    heroSubtitle:
      'Join pharmacists and teams who help people use treatment well.',
    about:
      '<p>We combine clinical pharmacy, dispensing and quality. You will have real responsibility for patient safety and the support to keep learning.</p>',
    departments: [
      'Clinical pharmacy',
      'Dispensing',
      'Quality & regulatory',
      'Supply chain',
    ],
    jobs: ['clinical-pharmacist', 'patient-coordinator', 'medical-records'],
    stages: [
      ...active(
        'Applied',
        'AI Shortlisted',
        'Screening',
        'Registration Check',
        'Pharmacist Interview',
        'HR Interview',
        'Offer'
      ),
      ...TERMINAL,
    ],
  },
];

export const getIndustryTemplate = (key?: string | null) =>
  INDUSTRY_TEMPLATES.find((t) => t.key === key);

export const getJobTemplate = (key?: string | null) =>
  JOB_TEMPLATES.find((t) => t.key === key);

export const INDUSTRY_KEYS = INDUSTRY_TEMPLATES.map((t) => t.key) as [
  IndustryKey,
  ...IndustryKey[],
];
