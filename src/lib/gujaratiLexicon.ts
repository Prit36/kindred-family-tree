/**
 * How names are actually spelled in Gujarati, for the ones letters alone can't settle.
 *
 * Names written in English letters drop most of what Gujarati spelling records: long and
 * short vowels (ગીતા, not ગિતા), dental or retroflex (કિરીટ, કાપડિયા), ન or ણ (પ્રવીણ, કિરણ),
 * and whether a compound keeps its full letters (હસમુખ, not હસ્મુખ). So the common names
 * are listed here as families write them; anything else is worked out from its parts and
 * from sound (see gujaratiNames.ts).
 *
 * Where the dictionary spelling (સાર્થ જોડણીકોશ) and the way names are commonly written
 * differ, the common one is used, as counted in Gujarati-language writing: જીતેન્દ્ર, શૈલેષ,
 * પિયુષ, જ્યોત્સના, હીના, મયુર. Where they agree or usage is split, the dictionary wins:
 * જિજ્ઞેશ, જિજ્ઞાસા, ઇલા, ઇન્દુ. Name suffixes are -ભાઈ and -બેન (ગીતાબેન), as written.
 *
 * Each entry is `spelling=ગુજરાતી`; `a|b=…` lists several spellings of one name. Names are
 * listed without -bhai, -ben, -kumar and the like, which are added on their own.
 */
const NAMES = `
aadhya=આધ્યા aakanksha=આકાંક્ષા aakash|akash=આકાશ aalok|alok=આલોક aansh=આંશ aarav|arav=આરવ
aarti|arati|arti=આરતી aarushi=આરુષી aary|aarya=આર્ય aaryan|aryan=આર્યન aasha|asha=આશા
aashish|ashish=આશિષ aavy=આવ્ય aayan=આયાન aayash=આયશ aayush|ayush=આયુષ aayushi|ayushi=આયુષી
abhay=અભય abhishek=અભિષેક aditya=આદિત્ય aekta|ekta=એકતા aevin=એવિન ajay=અજય ajit=અજિત
aksh=અક્ષ akshay=અક્ષય akshi=અક્ષી akshj=અક્ષજ alka=અલકા alkesh=અલકેશ alpa=અલ્પા
alpesh=અલ્પેશ amardeep=અમરદીપ ami=અમી amit=અમિત amita=અમિતા amrat=અમરત amrut|amrit=અમૃત
anand=આનંદ aniket=અનિકેત anil=અનિલ anirudh=અનિરુદ્ધ anita=અનિતા anjali|anjli=અંજલિ
anjana|anjna=અંજના ankit=અંકિત ankita=અંકિતા annya|anya=અન્યા ansh=અંશ anvi=અન્વી
apeksha=અપેક્ષા archi=અર્ચી archana|archna=અર્ચના arjan=અરજણ arjun=અર્જુન
arpana|arpna=અર્પણા aruna=અરુણા arvind=અરવિંદ ashok=અશોક ashvin|ashwin|aswin=અશ્વિન
asmita=અસ્મિતા axit|akshit=અક્ષિત bakul=બકુલ balvant|balwant=બળવંત bansari=બંસરી
banshi|bansi=બંસી batuk=બટુક bechar=બેચર beena|bina=બીના beli=બેલી bhadresh=ભદ્રેશ
bhagirath=ભગીરથ bhagvati|bhagwati=ભગવતી bhagyesh|bhagyeg=ભાગ્યેશ bhakti=ભક્તિ bhanji=ભાણજી
bhanu=ભાનુ bharat=ભરત bharati|bharti=ભારતી bhargav=ભાર્ગવ bhaskar=ભાસ્કર bhaumik=ભૌમિક
bhautik=ભૌતિક bhavan=ભવાન bhavana|bhavna=ભાવના bhavdeep=ભાવદીપ bhavesh=ભાવેશ bhavik=ભાવિક
bhavika=ભાવિકા bhavin=ભાવિન bhavini=ભાવિની bhavy=ભવ્ય bhavya=ભવ્યા bhikha=ભીખા bhikhu=ભીખુ
bhimji=ભીમજી bhumi=ભૂમિ bhumika=ભૂમિકા bhumisha=ભૂમિશા bhumit=ભૂમિત bhupat=ભૂપત
bhupendra=ભૂપેન્દ્ર bijal=બિજલ binda=બિંદા bindu=બિંદુ binita=બિનીતા bipin=બિપિન birju=બિરજુ
bodha=બોધા brijal=બ્રિજલ brijesh=બ્રિજેશ chaitali=ચૈતાલી champa|chmpa=ચંપા chandni=ચાંદની
chandrika|chndrika=ચંદ્રિકા chandrakant|chandrkant=ચંદ્રકાંત chandu=ચંદુ charmi=ચાર્મી
charvi=ચાર્વી chetan=ચેતન chetana|chetna=ચેતના chhagan=છગન chhaya=છાયા chirag=ચિરાગ
dahya=ડાહ્યા daksesh|dakshesh=દક્ષેશ dalpat=દલપત dalsukh=દલસુખ damji=દામજી
damyanti|damayanti=દમયંતી darshak=દર્શક darshan=દર્શન darshana|darshna=દર્શના
darshti|drashti|drushti=દ્રષ્ટિ dax|daksh=દક્ષ daxa|daksha=દક્ષા dayal=દયાળ deep|dip=દીપ
demish=દેમિશ densi=ડેન્સી dev=દેવ devang=દેવાંગ devangi=દેવાંગી devanshi=દેવાંશી devesh=દેવેશ
dhairy|dhairya=ધૈર્ય dhani=ધની dhananjay|dhanjay=ધનંજય dhanji=ધનજી dhanvi=ધન્વી dhara=ધારા
dharam=ધરમ dharamshi=ધરમશી dharav=ધરવ dharika=ધારિકા dharm=ધર્મ dharmendra=ધર્મેન્દ્ર
dharmesh=ધર્મેશ dharmik=ધાર્મિક dharmishtha=ધર્મિષ્ઠા dharti=ધરતી dhaval=ધવલ dhavni|dhvani=ધ્વનિ
dhiraj=ધીરજ dhiru=ધીરુ dhruhil=ધ્રુહિલ dhruti=ધૃતિ dhruv=ધ્રુવ dhruval=ધ્રુવલ
dhruvansh=ધ્રુવાંશ dhruvanshu=ધ્રુવાંશુ dhruvashi=ધ્રુવાશી dhruvi=ધ્રુવી dhruvika=ધ્રુવિકા
dhruvil=ધ્રુવિલ dhruvin=ધ્રુવિન dhruvisha=ધ્રુવિશા dhvij=ધ્વિજ dhyan=ધ્યાન dhyey=ધ્યેય
dikshita|dixita=દીક્ષિતા dilip=દિલીપ dimpal|dimple=ડિમ્પલ dinesh=દિનેશ dipak|deepak=દીપક
dipali|deepali=દીપાલી dipashi=દીપાશી dipesh=દીપેશ dipika|deepika=દીપિકા dish=દિશ disha=દિશા
dishant=દિશાંત dishita=દિશિતા divy=દિવ્ય divya=દિવ્યા divyang=દિવ્યાંગ divyesh=દિવ્યેશ
dixit|dikshit=દીક્ષિત diya=દિયા doli|dolly=ડોલી dudha=દૂધા falgun=ફાલ્ગુન falguni=ફાલ્ગુની
feni=ફેની fenil=ફેનિલ fenis=ફેનિસ foram=ફોરમ ganesh=ગણેશ ganga=ગંગા ganpat=ગણપત
gaurang=ગૌરાંગ gaurav=ગૌરવ gauri|gouri=ગૌરી gautam=ગૌતમ geeta|gita=ગીતા ghanshyam=ઘનશ્યામ
girdhar|girdhari=ગિરધર girish=ગિરીશ godavari=ગોદાવરી gopal=ગોપાલ gordhan=ગોરધન govind=ગોવિંદ
granth=ગ્રંથ griva=ગ્રીવા gunjan=ગુંજન gunvant=ગુણવંત gunvati=ગુણવતી hamir=હમીર hani=હની
hansa=હંસા hardi=હાર્દી hardik=હાર્દિક haresh=હરેશ hari=હરિ harji=હરજી harjivan=હરજીવન
harpit=હરપીત harsh=હર્ષ harsha=હર્ષા harshad=હર્ષદ harshida=હર્ષિદા harshika=હર્ષિકા
harshil=હર્ષિલ harshit=હર્ષિત harshvi=હર્ષવી hasmukh|hashmukh=હસમુખ hasti=હસ્તી
hastika=હસ્તિકા heena|hina=હીના heer=હીર heera|hira=હીરા heet=હીત hem=હેમ hema=હેમા
hemakshi=હેમાક્ષી hemlata|hemalata|hemalta|hemlta=હેમલતા hemang=હેમાંગ hemangi=હેમાંગી
hemant=હેમંત hency|hensi=હેન્સી heni=હેની henil=હેનીલ henvi=હેન્વી herin=હેરીન het=હેત
hetal=હેતલ hetang=હેતાંગ hetansh=હેતાંશ hetanshi=હેતાંશી hetvi=હેત્વી himanshi|himashi=હિમાંશી
himanshu=હિમાંશુ himmat|himmt=હિંમત hinakshi=હિનાક્ષી hinal=હિનલ hiral=હિરલ hiren=હિરેન
hitakshi=હિતાક્ષી hitendra=હિતેન્દ્ર hitesh=હિતેશ hitigna=હિતજ્ઞા hitvik=હિત્વિક ila=ઇલા
indu=ઇન્દુ isha=ઈશા ishani=ઈશાની ishika=ઈશિકા ishvar|ishwar|ishavar|ishvr=ઈશ્વર jadav=જાદવ
jagdish|jagadish=જગદીશ jagdishvari=જગદીશ્વરી jagjivan=જગજીવન jagruti=જાગૃતિ
jahnavi|jahanvi|jahnvi=જાહ્નવી jaimin=જૈમિન jaimini=જૈમિની jalpa=જલ્પા jalpesh=જલ્પેશ
janak=જનક janki|janaki=જાનકી janvi=જાનવી jash=જશ jashu=જશુ jashvant|jasvant=જશવંત jasmat=જસમત
jasmin=જાસ્મીન jasmukh=જસમુખ jasu=જસુ jasumati=જસુમતી jatin=જતીન jay=જય jaya=જયા
jaydeep|jaydip=જયદીપ jaydev=જયદેવ jayesh=જયેશ jayanti|jaynti=જયંતી jayshree|jayshri=જયશ્રી
jeel=જીલ jenil=જેનિલ jenish=જેનિશ jenisha=જેનિશા jenti=જેન્તી jigar=જીગર jigesha=જીગેશા
jigisha|jigisa=જીગીશા jigna=જિજ્ઞા jignasa|jignasha=જિજ્ઞાસા jignesh=જિજ્ઞેશ jignesha=જિજ્ઞેશા
jimit=જીમિત jinal=જીનલ jinkal=જીંકલ jital=જીતલ jitendra=જીતેન્દ્ર jitesh=જીતેશ jitu=જીતુ
jivan=જીવન jiya=જીયા jiyan=જીયાન jiyanshi=જીયાંશી jyotsna|jyotsana|jyoshna|jyosna=જ્યોત્સના
jyoti=જ્યોતિ kailas|kailash=કૈલાસ kajal=કાજલ kakshil=કક્ષિલ kalpa=કલ્પા kalpana|kalpna=કલ્પના
kalpesh=કલ્પેશ kalyan=કલ્યાણ kamal=કમલ kamini=કામિની kamla|kamala=કમળા kamlesh=કમલેશ
kanan=કાનન kanchan=કંચન kanishka=કનિષ્કા kanji=કાનજી kanta=કાંતા kanti=કાંતિ kantilal=કાંતિલાલ
karan=કરણ karishma=કરિશ્મા karm=કર્મ karmshi|karamshi=કરમશી karshan=કરસન kartik=કાર્તિક
kashyap=કશ્યપ kaushal=કૌશલ kaushik=કૌશિક kautik=કૌતિક kavita=કવિતા kavy=કાવ્ય kavya=કાવ્યા
kenil=કેનિલ keshav=કેશવ ketan=કેતન ketika=કેતિકા keval=કેવલ kevil=કેવિલ kevin=કેવિન keya=કેયા
keyur=કેયુર khimji=ખીમજી khoda=ખોડા khodidas=ખોડીદાસ khush=ખુશ khushal=ખુશાલ
khushali=ખુશાલી khushani=ખુશાની khushi=ખુશી kinal=કિનલ kinjal=કિંજલ kiran=કિરણ kirit=કિરીટ
kirti=કીર્તિ kirtik=કીર્તિક kishan=કિશન kishor|kishore=કિશોર kokila=કોકિલા komal=કોમલ
krina=ક્રિના krish=ક્રિશ krisha=ક્રિશા krishiv=ક્રિશિવ krishna=કૃષ્ણા krunal=કૃણાલ krupa=કૃપા
krupal=કૃપાલ krupali=કૃપાલી krushank=કૃશાંક kruti=કૃતિ kunj=કુંજ kunjal=કુંજલ
kunvarji|kuvarji|kunverji=કુંવરજી kushal=કુશલ kusum=કુસુમ labhu=લાભુ laksh=લક્ષ
lakshmi|laxmi=લક્ષ્મી lalit=લલિત lalita=લલિતા lalji=લાલજી lata=લતા lavji=લવજી lavsukh=લવસુખ
lavy=લવ્ય lesha=લેશા lila|leela=લીલા madhu=મધુ magan=મગન mahek=મહેક mahendra=મહેન્દ્ર
mahesh=મહેશ mahi=માહી mahima=મહિમા maitr=મૈત્ર maitri=મૈત્રી maitrik=મૈત્રિક malvika=માલવિકા
mamta=મમતા man=મન manan=મનન manav=માનવ mangla=મંગળા mangu=મંગુ manhar=મનહર manish=મનીષ
manisha=મનીષા manita=મનીતા manju=મંજુ manjula|majula=મંજુલા manoj=મનોજ mansi|manshi=માનસી
mansukh=મનસુખ manth=મંથ manthan=મંથન manu=મનુ margi=માર્ગી maulik=મૌલિક maunish=મૌનિશ
mavji=માવજી maya=માયા mayank=મયંક mayur=મયુર mayuri=મયુરી medh=મેધ medha=મેધા
meena|mina=મીના meet|mit=મીત megha=મેઘા mehul=મેહુલ mensi=મેન્સી milan=મિલન
minakshi|meenakshi=મીનાક્ષી minal=મીનલ mishva=મિશ્વા mital=મિતલ mitali=મિતાલી
mitesh|miteash=મિતેશ mitisha=મિતિશા mohan=મોહન mohanlal=મોહનલાલ mohini=મોહિની mohit=મોહિત
moksha=મોક્ષા mona=મોના monika=મોનિકા monil=મોનિલ monisha=મોનિશા mukesh=મુકેશ mukund=મુકુંદ
mulji=મૂળજી nagaji=નાગજી nagar=નાગર nagin=નગીન naitik=નૈતિક naksh=નક્ષ nandlal=નંદલાલ
nanji=નાનજી naran=નારણ narendra=નરેન્દ્ર naresh=નરેશ narottam=નરોત્તમ narsinh|narsih=નરસિંહ
natu=નટુ natvar=નટવર natvarlal=નટવરલાલ navin|naveen=નવીન navneet|navnit=નવનીત navya=નવ્યા
nayan=નયન nayana|nayna=નયના neel|nil=નીલ neeta|nita=નીતા neha=નેહા nehal=નેહલ nensi=નેન્સી
netr|netra=નેત્ર nevya=નેવ્યા nidhi=નિધિ nihal=નિહાલ nikhil=નિખિલ nikhita=નિખિતા nikita=નિકિતા
nikul=નિકુલ nikunj=નિકુંજ nila=નીલા nilam|neelam=નીલમ nilesh=નિલેશ nimesh=નિમેષ nimish=નિમિષ
nimisha=નિમિષા nimla=નિમલા nina|neena=નીના niraj|neeraj=નીરજ nirali=નિરાલી nirant=નિરંત
nirat=નિરત nirav=નીરવ nirmala|nirmla=નિર્મળા niranjana|nirnjna=નિરંજના niru=નીરુ nisha=નિશા
nitesh=નિતેશ nitin=નીતિન nitya=નિત્યા niva=નિવા niyati=નિયતિ odhavji=ઓધવજી om=ઓમ
padma=પદ્મા pahel=પહેલ pal=પલ palak=પલક pallavi=પલ્લવી pallvika|pallavika=પલ્લવિકા
pankaj=પંકજ panna=પન્ના paras=પારસ paresh=પરેશ pari=પરી parita=પરિતા parmod=પરમોદ
parshotam|parsottam|parshottam|purshottam=પરસોત્તમ parth=પાર્થ parthiv=પાર્થિવ parthvi=પાર્થવી
parul=પારુલ parvati|parvti=પાર્વતી payal=પાયલ pinkal=પિંકલ pinki=પિંકી pitambar=પીતાંબર
piyush=પિયુષ pooja|puja=પૂજા poonam|punam=પૂનમ prabha=પ્રભા prabhu=પ્રભુ prachi=પ્રાચી
pradip|pradeep=પ્રદીપ praful|prafull=પ્રફુલ prafula=પ્રફુલા pragna|pragnya=પ્રજ્ઞા
pragnesh=પ્રજ્ઞેશ prakash|praksh=પ્રકાશ pramod=પ્રમોદ pranshu=પ્રાંશુ prarambh|prarmbh=પ્રારંભ
prashant=પ્રશાંત pratap=પ્રતાપ pratham=પ્રથમ pratik|prateek=પ્રતીક pratiksha=પ્રતીક્ષા
pravin|praveen=પ્રવીણ pravina=પ્રવીણા preksha=પ્રેક્ષા premal=પ્રેમલ premji=પ્રેમજી
prince|princ|prins=પ્રિન્સ prinsi=પ્રિન્સી prisha=પ્રિશા prit|preet=પ્રીત pritesh=પ્રિતેશ
priti|preeti=પ્રીતિ priya=પ્રિયા priyank=પ્રિયાંક priyanka=પ્રિયંકા priyansh=પ્રિયાંશ
priyanshi=પ્રિયાંશી priyesh=પ્રિયેશ puri=પુરી pushpa=પુષ્પા raghav=રાઘવ raghu=રઘુ rahul=રાહુલ
raj=રાજ rajan=રાજન rajendra=રાજેન્દ્ર rajesh=રાજેશ rajeshree|rajeshri|rajshree=રાજશ્રી
rajnikant|rajanikant=રજનીકાંત rajpal=રાજપાલ raju=રાજુ rajvi=રાજવી rakesh=રાકેશ rama=રમા
raman=રમણ rambha=રંભા ramesh=રમેશ ramila=રમીલા ramji=રામજી ramnik|ramanik=રમણીક ramu=રામુ
ranchhod=રણછોડ ranjan=રંજન rashmi=રશ્મિ rasik=રસિક rasila|rashila=રસીલા ratan=રતન ravaji=રવાજી
ravi=રવિ ravji=રવજી reena|rina=રીના rekha=રેખા rensi=રેન્સી renuka=રેણુકા riddham|ridhdhm=રિદ્ધમ
riddhi|ridhdhi=રિદ્ધિ rimpal=રિમ્પલ rinkal=રિંકલ rishant=રિશાંત rishi|rushi=ઋષિ
rishika|rushika=ઋષિકા rita|reeta=રીટા ritesh=રિતેશ rivan=રિવાન riya=રિયા rohit=રોહિત romik=રોમિક
roshni|roshani=રોશની ruchik=રુચિક ruchita=રુચિતા rudra=રુદ્ર ruhi=રુહી rupal=રૂપલ rupesh=રૂપેશ
rutik|ritik=ઋતિક rutva=ઋત્વા rutvik=ઋત્વિક rutvika=ઋત્વિકા sachin=સચિન sagar=સાગર sahil=સાહિલ
sakshi=સાક્ષી sameer|samir=સમીર samu=સમુ sandip|sandeep=સંદીપ sangita|sangeeta=સંગીતા
sanil=સનિલ sanjay=સંજય sanket=સંકેત sapna=સપના sarika=સારિકા saroj=સરોજ satish=સતીશ
saumya=સૌમ્યા saurabh=સૌરભ savita=સવિતા savji=સવજી seema|sima=સીમા sejal=સેજલ
shailendra=શૈલેન્દ્ર shailesh|sailesh=શૈલેષ shamji=શામજી shani=શની shanta=શાંતા shanti=શાંતિ
shantu=શાંતુ sharda|sharada=શારદા shashikant|shshikant=શશીકાંત shaurya|shaury=શૌર્ય
shilpa=શિલ્પા shital|sheetal=શીતલ shiv=શિવ shlok=શ્લોક shobhana|shobhna=શોભના
shraddha|shrddha=શ્રદ્ધા shreeraj=શ્રીરાજ shreya=શ્રેયા shubham=શુભમ shubhvi=શુભ્વી sinal=સિનલ
siya=સિયા smit=સ્મિત smita=સ્મિતા sneh=સ્નેહ sneha=સ્નેહા snehal|shnehal=સ્નેહલ soham=સોહમ
sohil=સોહિલ sonal=સોનલ sonali=સોનાલી sparsh|sprsh=સ્પર્શ srushti=સૃષ્ટિ sudhir=સુધીર suhas=સુહાસ
sumit=સુમિત sunil=સુનીલ sunita=સુનીતા sunny=સની suraj=સૂરજ surbhi=સુરભિ suresh=સુરેશ
suryadeep|surydeep=સૂર્યદીપ sushila=સુશીલા sushma|susma=સુષમા swati=સ્વાતિ shweta|sweta=શ્વેતા
swetang|shwetang=શ્વેતાંગ tanishk=તનિષ્ક tarak=તારક tarla=તરલા tarlika=તરલિકા tarun=તરુણ
taruna=તરુણા tathy=તથ્ય tejal=તેજલ tejas|tejash=તેજસ thakarshi=ઠાકરશી tirth=તીર્થ tithi=તિથિ
tribhovan|tribhuvan=ત્રિભોવન trikam=ત્રિકમ trisha=ત્રિશા trupti=તૃપ્તિ trusha=તૃષા trushna=તૃષ્ણા
tushar=તુષાર twinkal|twinkle=ટ્વિંકલ uday=ઉદય udesh=ઉદેશ ujam=ઉજમ ujas=ઉજાસ
uma|uama=ઉમા umang=ઉમંગ umesh=ઉમેશ urmila=ઊર્મિલા urmish|uarmish=ઉર્મિશ
urvashi|uravashi|uarvshi=ઉર્વશી urvik=ઉર્વિક urvisha=ઉર્વિશા usha=ઉષા utkarsh=ઉત્કર્ષ
vaishali=વૈશાલી valji=વાલજી vandan|vandn=વંદન vandana|vandna=વંદના vanita=વનિતા vansh=વંશ
vanshil=વંશિલ varahi=વારાહી varsha=વર્ષા vasant=વસંત vasanti|vasnti=વસંતી vashram=વશરામ
vatsal=વત્સલ ved=વેદ vaidehi|vedehi=વૈદેહી veer|vir=વીર vency|vensi=વેન્સી vidhi=વિધિ
vidhya|vidya=વિદ્યા vihan=વિહાન vijal=વિજલ vijay=વિજય vijaya|vijya=વિજયા vikas=વિકાસ
vikesh=વિકેશ vilas=વિલાસ vimal=વિમલ vimala|vimla=વિમળા vina|veena=વીણા vinay=વિનય vinod=વિનોદ
vipul=વિપુલ viraj=વિરાજ viral=વિરલ virji=વીરજી vishal=વિશાલ vishva|visva|vishwa=વિશ્વા
vithal|viththal|vitthal=વિઠ્ઠલ vivan=વિવાન vivek=વિવેક viyan=વિયાન vraj=વ્રજ vrushabh|vrushbh=વૃષભ
vrushita=વૃષિતા yagnesh=યજ્ઞેશ yagnik=યાજ્ઞિક yash=યશ yashvi=યશ્વી yatin=યતીન yogesh=યોગેશ
yug=યુગ yuvraj=યુવરાજ zaver|javer=ઝવેર zeel=ઝીલ manali=મનાલી shreyansh=શ્રેયાંશ kavish=કવિશ
rinkalbrn=રિંકલબેન rameshhai=રમેશભાઈ manojbahi=મનોજભાઈ
`;

/**
 * Surnames, mostly from the villages families came from: ભલગામ (Dasada) → ભલગામિયા, કટુડા
 * (Wadhwan) → કટુડિયા, વડગામ → વડગામા, લખતર → લખતરિયા. The ending is written િયા, as in
 * કાપડિયા and ધોળકિયા.
 */
const SURNAMES = `
baroliya=બરોલિયા bhalgamiya|bhalagamiya|bhlagamiya=ભલગામિયા bhamani=ભામાણી bhimani=ભીમાણી
charoliya=ચારોલિયા danani|dananni=દાણાણી deraniya=દેરાણિયા golaniya|goliniya|goloniya=ગોલાણિયા
hamirani|hamrani=હમીરાણી jotaniya=જોટાણિયા kapdiya|kapadiya|kapadia=કાપડિયા katudiya|kadudiya|karudiya=કટુડિયા
lakhmani|lakhamani=લાખમાણી lakhtariya=લખતરિયા luvani=લુવાણી meghani=મેઘાણી mithapara=મીઠાપરા
mitliya=મીતલિયા mojidra|mojidara=મોજીદ્રા mokani|moakani|moakni=મોકાણી mulani=મુલાણી
parbadiya=પરબડિયા prajapati=પ્રજાપતિ ramani=રામાણી ranpara|ranapara=રાણપરા sapra=સાપરા
saroliya=સરોલિયા savani=સવાણી turkhiya=તુરખિયા vadgama=વડગામા
zanzrukiya|zanrukiya|zaznrukiya=ઝાંઝરુકિયા patel=પટેલ shah=શાહ mehta=મહેતા desai=દેસાઈ
joshi=જોશી trivedi=ત્રિવેદી pandya=પંડ્યા bhatt=ભટ્ટ parmar=પરમાર solanki=સોલંકી
chauhan=ચૌહાણ makwana=મકવાણા rathod=રાઠોડ vaghela=વાઘેલા chavda=ચાવડા thakkar=ઠક્કર
modi=મોદી gandhi=ગાંધી dave=દવે vyas=વ્યાસ jani=જાની raval=રાવલ panchal=પંચાલ
`;

/** Names from outside Gujarat, as they are said. */
const FOREIGN = `
alex=એલેક્સ arthur=આર્થર ashby=એશબી ava=એવા bennett=બેનેટ carol=કેરોલ chloe=ક્લોઈ
clarke|clark=ક્લાર્ક daniel=ડેનિયલ david=ડેવિડ dorothy=ડોરોથી ellie=એલી emma=એમા finn=ફિન
george=જ્યોર્જ helen=હેલન hughes=હ્યુજીસ isla=આઈલા laura=લૌરા leo=લિયો margaret=માર્ગારેટ
morgan=મોર્ગન noah=નોઆ owen=ઓવેન peter=પીટર reid=રીડ robert=રોબર્ટ ruth=રૂથ sam=સેમ
sofia|sophia=સોફિયા susan=સુઝન tom=ટોમ happy=હેપ્પી krezi|crazy=ક્રેઝી
`;

/**
 * Pieces Gujarati names are built from, used when a whole name isn't listed:
 * "Kishanlal" is કિશન + લાલ, "Jatinkumar" is જતીન + કુમાર.
 */
const PARTS = `
bhai=ભાઈ ben=બેન bahen|behen=બહેન kumar=કુમાર kumari=કુમારી lal=લાલ das=દાસ ji=જી
chand=ચંદ chandra=ચંદ્ર kant=કાંત prasad=પ્રસાદ shankar=શંકર sinh|singh=સિંહ nath=નાથ
rai|ray=રાય gauri=ગૌરી devi=દેવી bala=બાળા vati=વતી mati=મતી shree|shri=શ્રી
sukh=સુખ mukh=મુખ deep|dip=દીપ raj=રાજ dev=દેવ
`;

function parse(...lists: string[]): Map<string, string> {
  const out = new Map<string, string>();
  for (const list of lists) {
    for (const entry of list.split(/\s+/)) {
      if (!entry) continue;
      const eq = entry.indexOf('=');
      const gu = entry.slice(eq + 1);
      for (const key of entry.slice(0, eq).split('|')) if (!out.has(key)) out.set(key, gu);
    }
  }
  return out;
}

/** Whole names and surnames. */
export const LEXICON = parse(NAMES, SURNAMES, FOREIGN);

/** Pieces that only ever follow the start of a name (-bhai, -lal, -kumar…). */
export const NAME_PARTS = parse(PARTS);
