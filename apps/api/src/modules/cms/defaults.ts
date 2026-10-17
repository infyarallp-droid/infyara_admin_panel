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
