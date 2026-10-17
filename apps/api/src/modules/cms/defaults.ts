// The website's original copy. Used as the starting draft for each content
// block until an admin saves their own version, so nothing changes on the
// website until someone edits it. (The website keeps the same text as its
// built-in fallback in src/content/defaults.ts.)

export const CONTENT_DEFAULTS: Record<string, Record<string, unknown>> = {
  'site.settings': {
    tagline: 'Yoga & Pilates',
    description:
      'Moksha Wellness offers yoga and Pilates classes in studio and online, and teacher training programmes for those who want to go deeper.',
    phone: '+91 78935 85558',
    whatsapp: '',
    email: 'themokshawellness@gmail.com',
    address: [],
    mapsUrl: 'https://www.google.com/search?kgmid=/g/11zd83mcsj&q=Moksha+Yoga+%26+pilates+studio',
    hours: [],
    instagram: '',
    facebook: '',
    youtube: '',
    footerNote: 'Practise within your own limits. Yoga and Pilates are not a substitute for medical advice.',
  },
  'home.hero': {
    eyebrow: 'Moksha Wellness · Yoga & Pilates',
    title: 'Come home to',
    titleEmphasis: 'your breath.',
    body: 'Yoga and Pilates for steadier bodies and quieter minds — in the studio, live online, and through teacher training for those ready to share the practice.',
    primaryCtaLabel: 'Start with an enquiry',
    primaryCtaHref: '/contact#enquire',
    secondaryCtaLabel: 'Explore classes',
    secondaryCtaHref: '/classes',
    imageUrl: '',
  },
  'home.pillars': {
    eyebrow: 'How we teach',
    title: 'Three ways to practise with us',
    intro: 'Whether you want a mat beside other people, a class in your living room, or the training to teach — there is a place to begin.',
    items: [
      {
        title: 'In the studio',
        text: 'Practise in person, in a room set aside for it — with a teacher who can see how you move and guide you through it.',
        ctaLabel: 'Studio classes',
        ctaHref: '/classes',
      },
      {
        title: 'Online, live',
        text: 'Join yoga and Pilates classes from home. The same teaching and the same group, wherever you happen to be.',
        ctaLabel: 'Online classes',
        ctaHref: '/classes',
      },
      {
        title: 'Teacher training',
        text: 'Structured programmes in yoga, mat Pilates, children’s yoga and aerial yoga for those who want to go deeper.',
        ctaLabel: 'Training programmes',
        ctaHref: '/teacher-training',
      },
    ],
  },
  'home.sections': {
    classesEyebrow: 'Regular classes',
    classesTitle: 'A practice you can keep coming back to',
    trainingEyebrow: 'Teacher training',
    trainingTitle: 'Ready to go deeper — or to teach?',
    trainingBody:
      'Our training programmes are for practitioners who want more than a weekly class: a fuller understanding of the practice, and the skill to guide others through it.',
    testimonialsEyebrow: 'Student stories',
    testimonialsTitle: 'In their own words',
    teamEyebrow: 'Our teachers',
    teamTitle: 'The people who will guide your practice',
    faqEyebrow: 'Questions',
    faqTitle: 'Good to know before you begin',
  },
  'home.steps': {
    eyebrow: 'Getting started',
    title: 'Three simple steps to your first class',
    items: [
      { title: 'Tell us about you', text: 'Send a short enquiry — what you would like to practise, and whether you prefer the studio or online.' },
      { title: 'We suggest a class', text: 'We reply with the class that fits, its timings and the plan options, and answer your questions.' },
      { title: 'Begin your practice', text: 'Complete a short health declaration and consent form, choose your plan, and step onto the mat.' },
    ],
  },
  'home.cta': {
    title: 'Your mat is waiting.',
    body: 'Tell us what you are looking for and we will help you find the right class, format and plan.',
  },
  'about.page': {
    heroEyebrow: 'About Moksha Wellness',
    heroTitle: 'A place to practise, patiently',
    heroBody:
      'Moksha means freedom. For us that is not a distant idea. It is the ease that comes from a body that moves well and a mind that has learned to be quiet for a while.',
    imageUrl: '',
    offerEyebrow: 'What we offer',
    offerTitle: 'Yoga and Pilates, taught with care',
    offerParagraphs: [
      'We teach regular yoga and Pilates classes in the studio and live online, and run teacher training programmes for practitioners who want to go further.',
      'Before you begin, we ask about your health and experience so that your teacher can guide you appropriately. From there, the work is simple: show up, breathe, and practise.',
    ],
    valuesEyebrow: 'How we practise',
    valuesTitle: 'What you can expect from us, and what we ask of you',
    values: [
      { title: 'Practice over performance', text: 'There is nothing to win here. We care about how a posture feels and what it teaches you, not how it looks.' },
      { title: 'Your limits are respected', text: 'You work within your own ability. Tell your teacher what is going on in your body, and ask for a modification whenever you need one.' },
      { title: 'Clear, careful teaching', text: 'Simple instruction, a steady pace and room to ask questions, in the studio and online alike.' },
      { title: 'A considerate space', text: 'Arrive on time, keep phones silent, and treat teachers and fellow students with respect. It is what lets everyone settle.' },
    ],
    ctaTitle: 'Come and practise with us.',
    ctaBody: 'Send an enquiry and we will help you choose a class, a format and a plan.',
  },
  'classes.page': {
    heroEyebrow: 'Regular classes',
    heroTitle: 'Yoga and Pilates, week after week',
    heroBody:
      'A regular practice does more than an occasional one. Choose a class in the studio or join live online — and ask us for the current timings and plans.',
    onlineEyebrow: 'Live online',
    onlineTitle: 'Practise from wherever you are',
    studioEyebrow: 'In person',
    studioTitle: 'Classes at the studio',
    ctaTitle: 'Not sure where to start?',
    ctaBody: 'Tell us about your experience and what you are hoping for. We will suggest a class that fits.',
  },
  'training.page': {
    heroEyebrow: 'Teacher training',
    heroTitle: 'For those who want to take the practice further',
    heroBody:
      'Five programmes across yoga and Pilates. Dates, duration, format and fees are shared when you enquire, so you always get the current intake.',
    expectEyebrow: 'What a training asks of you',
    expectTitle: 'More than a certificate',
    expectations: [
      { title: 'Your own practice first', text: 'Teaching grows out of practice. Each programme deepens what you do on the mat before asking you to guide anyone else.' },
      { title: 'Learning to teach', text: 'How to plan a class, give clear instruction, and adapt a practice to the person in front of you.' },
      { title: 'Safety and responsibility', text: 'Working within limits, your own and those of your students, and knowing when to modify or stop.' },
    ],
    ctaTitle: 'Thinking about a training?',
    ctaBody: 'Tell us which programme interests you and where you are in your practice. We will send the details of the next intake.',
  },
  'contact.page': {
    heroEyebrow: 'Contact',
    heroTitle: 'Let us find the right class for you',
    heroBody: 'Tell us what you would like to practise. We will reply with the class that fits, its timings and the plan options.',
    nextSteps: [
      'Your enquiry reaches the studio team straight away.',
      'We reply on the mobile number you share.',
      'You choose a class and plan, and begin.',
    ],
  },
  'team.page': {
    heroEyebrow: 'Our team',
    heroTitle: 'The teachers behind your practice',
    heroBody: 'Experienced, attentive teachers who care about how you move — and why.',
  },
  'testimonials.page': {
    heroEyebrow: 'Student stories',
    heroTitle: 'In their own words',
    heroBody: 'What practising at Moksha Wellness has meant to some of our students.',
  },
  'gallery.page': {
    heroEyebrow: 'Gallery',
    heroTitle: 'Inside the studio',
    heroBody: 'A look at our space, our classes and our community.',
  },

  // ── Suggested drafts for the policy pages. Not shown on the website until an admin
  //    reviews, edits and publishes them: they become the studio's binding policies. ──
  'legal.privacy': {
    title: 'Privacy policy',
    updated: '',
    intro:
      'This policy explains what personal information Moksha Wellness collects, why we collect it, and how we look after it. It applies to our website, our studio and our online classes.',
    sections: [
      {
        title: 'What we collect',
        text: 'When you enquire or create an account: your name, mobile number and (optionally) email address. If you sign in with Google, we receive your name and email address from Google.\n\nWhen you join a class: the details on your admission and consent form, including the health information you choose to declare so that your teacher can guide you safely.\n\nWhen you pay online: the payment is processed by Razorpay. We receive confirmation of the payment and its reference number. We never see or store your card, UPI PIN or bank login details.',
      },
      {
        title: 'How we use it',
        text: 'To reply to your enquiries, manage your enrolment, timings, renewals and invoices, issue receipts, keep you safe in class, and meet our legal and accounting obligations.',
      },
      {
        title: 'WhatsApp messages',
        text: 'We send WhatsApp messages (class reminders, payment updates and studio announcements) only if you have agreed to receive them. You can stop them at any time by replying STOP, or from your account settings on our website.',
      },
      {
        title: 'Who we share it with',
        text: 'We do not sell your information. We share it only with service providers who help us run the studio — such as our payment gateway (Razorpay), WhatsApp (Meta), and our secure hosting and database providers — and only as needed for them to provide their service, or when the law requires it.',
      },
      {
        title: 'How long we keep it',
        text: 'We keep your records for as long as you are a student and afterwards for as long as needed for accounting, tax and legal purposes. Enquiries that do not lead to enrolment are deleted when they are no longer needed.',
      },
      {
        title: 'Your choices',
        text: 'You can ask us for a copy of your information, ask us to correct it, or ask us to delete it where we are not required to keep it. Contact us using the details on our Contact page.',
      },
    ],
  },
  'legal.terms': {
    title: 'Terms & conditions',
    updated: '',
    intro: 'These terms apply when you enquire, create an account, enrol in a class or training programme, or pay on the Moksha Wellness website.',
    sections: [
      {
        title: 'Your account',
        text: 'Keep your password private. You are responsible for activity on your account. Tell us straight away if you think someone else has used it.',
      },
      {
        title: 'Health and safety',
        text: 'Yoga and Pilates are physical activities. Before you begin, you complete a health declaration and consent form. Please tell your teacher about any injury, condition or pregnancy, practise within your own limits, and consult your doctor if you are unsure whether a practice is right for you. Our classes are not a substitute for medical advice.',
      },
      {
        title: 'Enrolment and plans',
        text: 'A plan entitles you to attend the class it covers for the period shown on your invoice. Plans are personal and cannot be transferred. Class timings may occasionally change; we will tell you in advance.',
      },
      {
        title: 'Payments',
        text: 'Fees are shown in Indian Rupees. Online payments are processed securely by Razorpay. Your enrolment is confirmed once the payment is successful, and a receipt is available in your account.',
      },
      {
        title: 'Studio conduct',
        text: 'Arrive on time, keep phones silent, and treat teachers and fellow students with respect. We may refuse or end a booking where conduct puts others at risk.',
      },
      {
        title: 'Changes to these terms',
        text: 'We may update these terms from time to time. The version on this page applies from the date shown above.',
      },
    ],
  },
  'legal.refunds': {
    title: 'Cancellation & refund policy',
    updated: '',
    intro: 'This policy explains when fees paid to Moksha Wellness can be cancelled or refunded.',
    sections: [
      {
        title: 'Cancellation by you',
        text: 'If you would like to cancel a plan before it starts, contact us before the start date and we will refund the fee in full. Once a plan or batch has started, fees are not refundable, but we may, at our discretion, move the remaining period to a later batch.',
      },
      {
        title: 'Cancellation by the studio',
        text: 'If we cancel a class, batch or programme, you will receive a full refund for the part you have not received, or you may choose to move to another batch.',
      },
      {
        title: 'Teacher training programmes',
        text: 'Teacher training fees and any non-refundable deposit are described in the programme details shared when you enrol.',
      },
      {
        title: 'How refunds are paid',
        text: 'Approved refunds of online payments are returned to the original payment method (card, UPI or bank account) through Razorpay, normally within 5–7 working days of approval. Cash payments are refunded at the studio or by bank transfer.',
      },
      {
        title: 'How to ask for a refund',
        text: 'Contact us with your name, mobile number and the invoice or receipt number. We reply within 3 working days.',
      },
    ],
  },
};

/** The original home-page FAQs, seeded as published FAQs when the FAQ list is empty. */
export const DEFAULT_FAQS = [
  {
    question: 'How do I find out about fees and timings?',
    answer:
      'Fees depend on the class and the plan you choose, and timings vary by batch. Send us an enquiry and we will share the current options for the class you are interested in.',
  },
  {
    question: 'Can I practise online instead of coming to the studio?',
    answer:
      'Yes. Regular yoga, advanced yoga and Pilates classes run online, and Mat Pilates Level 1 Teacher Training is offered both in the studio and online. Each class page shows how it is taught.',
  },
  {
    question: 'I have an injury or a health condition. Can I still join?',
    answer:
      'Tell us when you enquire. Every student completes a health declaration before starting, so your teacher knows what to adapt. If you are unsure whether a practice is right for you, please check with your doctor first.',
  },
  {
    question: 'I am not sure which class is right for me.',
    answer: 'Choose “Not sure yet — help me choose” on the enquiry form and tell us a little about your experience. We will suggest where to start.',
  },
  {
    question: 'What do I need before my first class?',
    answer:
      'We will tell you exactly what to bring or set up when we confirm your class. For online classes you will need a quiet space, a mat and a stable connection.',
  },
];

/** Website copy for each catalogue course (matched by course code), used to seed the public fields once. */
export const PROGRAMME_DEFAULTS: Record<string, { slug: string; summary: string; forWhom: string; order: number }> = {
  'REG-YOGA-STUDIO': {
    slug: 'regular-studio-yoga',
    summary: 'A steady, guided practice in the studio — posture, breath and rest, taught in person, at an unhurried pace.',
    forWhom: 'For anyone who wants a regular practice with a teacher in the room.',
    order: 1,
  },
  'REG-YOGA-ONLINE': {
    slug: 'regular-yoga-online',
    summary: 'The same guided practice, live from wherever you are. Roll out a mat, join the session and practise with the group.',
    forWhom: 'For those who travel, live further away, or simply prefer to practise at home.',
    order: 2,
  },
  'REG-YOGA-ADV-ONLINE': {
    slug: 'advanced-yoga-online',
    summary: 'A more demanding online practice for students who already have a foundation and want to build strength, depth and focus.',
    forWhom: 'For experienced practitioners ready for a stronger practice.',
    order: 3,
  },
  'REG-PILATES-ONLINE': {
    slug: 'pilates-online',
    summary: 'Mat-based Pilates taught live online: controlled, precise movement that builds core strength, posture and mobility.',
    forWhom: 'For those who want strength and stability work they can do at home.',
    order: 4,
  },
  'REG-PILATES': {
    slug: 'regular-pilates',
    summary: 'Ongoing Pilates classes focused on core strength, alignment and balanced, efficient movement.',
    forWhom: 'For anyone who wants Pilates as a consistent part of their week.',
    order: 5,
  },
  'TTC-YOGA-200': {
    slug: '200-hour-yoga-teacher-training',
    summary: 'The foundational training: deepen your own practice and learn how to guide others through a class safely and clearly.',
    forWhom: 'For committed practitioners taking their first step towards teaching.',
    order: 10,
  },
  'TTC-YOGA-300': {
    slug: '300-hour-advanced-yoga-teacher-training',
    summary: 'An advanced training that builds on a foundational course, refining both personal practice and teaching skill.',
    forWhom: 'For teachers and practitioners who have completed a foundational training.',
    order: 11,
  },
  'TTC-MAT-PILATES-L1': {
    slug: 'mat-pilates-level-1-teacher-training',
    summary: 'Learn the mat Pilates repertoire and how to teach it — offered both in the studio and online.',
    forWhom: 'For movement teachers and Pilates students who want to instruct mat classes.',
    order: 12,
  },
  'TTC-BALA-YOGA': {
    slug: 'bala-yoga-teacher-training',
    summary: 'A training in sharing yoga with children: how to make practice playful, safe and age-appropriate.',
    forWhom: 'For teachers, parents and educators who want to teach yoga to children.',
    order: 13,
  },
  'TRN-AERIAL-YOGA': {
    slug: 'aerial-yoga-training',
    summary: 'Hands-on training in aerial yoga, taught in the studio where the equipment and supervision are.',
    forWhom: 'For practitioners and teachers who want to explore and teach aerial practice.',
    order: 14,
  },
};
